'use strict';

// The MCP server (POST /mcp): tools an AI (Claude, ChatGPT…) uses to fill
// question banks. Stateless: a fresh server per request. The OAuth token
// only lets the app in; whose banks it fills comes from the conversation's
// link (links.js), since one connection can be shared by several people.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { GameError } = require('./errors');
const banks = require('./banks');
const { createLink, findLink, linkedAccount, WAIT_MS } = require('./links');

const INSTRUCTIONS = [
  'This server adds question banks to the user\'s account on «ألعاب الشلة» (Alab Al-Shilla), a party-games site for Saudi friend groups.',
  'Every conversation must first be linked to the person\'s own account: call link_account, show them the link_url, wait until they say they have logged in, call check_link and tell them which account it is, then pass that link_id with every bank tool. Never reuse a link_id from another conversation.',
  'Call games_guide first to learn each game\'s format and rules. Before adding to an existing bank, call get_bank to avoid duplicates.',
  'Write in simple Saudi Arabic, keep answers short and unambiguous, and send items in batches of up to 200 (30 pictures).',
].join(' ');

function guideText(baseUrl) {
  const games = Object.entries(banks.GAMES).map(([id, g]) => `## ${g.emoji} ${g.name} (game: ${id})\n${g.describe}`).join('\n\n');
  return `# ألعاب الشلة — how to write question banks

${games}

## Rules for every game
- Arabic, simple Saudi dialect where natural; facts must be correct and answers short (a word or a name).
- No duplicates inside a bank; questions already in the site's own bank are skipped automatically.
- Religious content follows the Shia Imami (Twelver) school. Avoid adult, political, or sectarian content.
- Pictures (time cards of type "image", or image_url on سين جيم questions): give a direct link to a JPG/PNG/WebP file that is publicly reachable, for example from upload.wikimedia.org. Pages (not files) and sites that block hotlinking fail. image_base64 also works for small pictures. At most 30 pictures per call.
- Limits: ${banks.LIMITS.banks} banks per account, ${banks.LIMITS.items} items per bank, ${banks.LIMITS.perCall} items per call, ${banks.LIMITS.perDay} items per day.

## Tools
- link_account / check_link: link this conversation to the person's own account first (every bank tool needs the link_id).
- list_my_banks / get_bank: see what's there.
- add_seen_questions, add_letters_questions, add_herd_questions, add_outsider_words, add_time_cards: add to a bank (bank_id), or create one (bank_name, emoji).
- remove_from_bank, delete_bank: clean up.

The user plays a bank by opening a room on the site while logged in and switching it on under «📚 بنوكي». Their account page: ${baseUrl}/account`;
}

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] });
const failure = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });

/** This conversation's link to the person's account (from link_account). */
const linkArg = {
  link_id: z.string().max(100).describe('This conversation\'s link_id from link_account (after the person logged in on the link).'),
};
/** Where new items go: an existing bank, or a new one with this name. */
const target = {
  ...linkArg,
  bank_id: z.number().int().positive().optional().describe('Add to this existing bank (from list_my_banks). Leave out to create a new bank.'),
  bank_name: z.string().max(30).optional().describe('Name for a new bank, in Arabic (required when bank_id is not given).'),
  emoji: z.string().max(8).optional().describe('One emoji for a new bank.'),
};
const picture = {
  image_url: z.string().max(2000).optional().describe('Direct link to a picture file (jpg/png/webp).'),
  image_base64: z.string().optional().describe('A small picture as base64 (or a data: URL), instead of image_url.'),
};

function buildServer({ grantAccountId, clientId, store, content, baseUrl }) {
  const server = new McpServer({ name: 'alab-al-shilla', title: 'ألعاب الشلة', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const run = (fn) => async (args) => {
    try {
      return text(await fn(args));
    } catch (err) {
      if (err instanceof GameError) return failure(err.message);
      console.error('[mcp]', err);
      return failure('Server error, try again.');
    }
  };
  const accountOf = (args) => linkedAccount(store, args.link_id, grantAccountId);
  const add = (game, listKey, toItems = (x) => x) => run(async (args) => {
    const accountId = await accountOf(args);
    if (!args.bank_id && !args.bank_name) throw new GameError('Give bank_name to create a new bank, or bank_id to add to an existing one.');
    const out = await banks.addItems(store, accountId, {
      game, bankId: args.bank_id ?? null, name: args.bank_name, emoji: args.emoji, items: toItems(args[listKey]),
    }, content()[game] ?? []);
    return { ...out, account_page: `${baseUrl}/account`, how_to_play: 'Open a room on the site while logged in and switch the bank on under «📚 بنوكي».' };
  });
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  const read = { readOnlyHint: true, openWorldHint: false };

  server.registerTool('games_guide', {
    title: 'كيف تكتب بنوك الأسئلة',
    description: 'Formats, rules and limits for every game on ألعاب الشلة. Read this before writing a bank.',
    annotations: read,
  }, async () => text(guideText(baseUrl)));

  server.registerTool('link_account', {
    title: 'اربط حسابك',
    description: 'Start here in every conversation: makes a link for the person to open and log in with their own «ألعاب الشلة» account. Show them link_url, then call check_link once they say they\'re done, and pass link_id with every bank tool.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, run(async () => {
    const client = clientId ? await store.getClient(clientId) : null;
    const id = await createLink(store, { grantAccountId, clientName: client?.client_name ?? null });
    return {
      link_id: id,
      link_url: `${baseUrl}/link?code=${encodeURIComponent(id)}`,
      expires_in_minutes: WAIT_MS / 60000,
      tell_user: 'افتح الرابط وادخل بحسابك في ألعاب الشلة، وبعدها قل لي «خلصت».',
    };
  }));

  server.registerTool('check_link', {
    title: 'مين مربوط؟',
    description: 'Whether the person has logged in on this conversation\'s link, and with which account. Tell them the username before adding anything.',
    inputSchema: linkArg,
    annotations: read,
  }, run(async ({ link_id: linkId }) => {
    const link = await findLink(store, linkId, grantAccountId);
    if (!link) throw new GameError('This link has expired or isn\'t this conversation\'s. Call link_account for a new one.');
    if (!link.accountId) {
      return { linked: false, link_url: `${baseUrl}/link?code=${encodeURIComponent(linkId)}`, tell_user: 'لسا ما دخلت بحسابك من الرابط. افتحه وادخل، وقل لي لما تخلص.' };
    }
    const account = await store.getAccount(link.accountId);
    return { linked: true, username: account?.username ?? null };
  }));

  server.registerTool('list_my_banks', {
    title: 'بنوكي',
    description: 'The linked account\'s question banks: id, game, name, item count, and whether each is ready to play.',
    inputSchema: linkArg,
    annotations: read,
  }, run(async (args) => ({ banks: (await store.listBanks(await accountOf(args))).map(banks.summary) })));

  server.registerTool('get_bank', {
    title: 'محتوى بنك',
    description: 'All items of one bank (with their ids), to review it or avoid duplicates before adding.',
    inputSchema: { ...linkArg, bank_id: z.number().int().positive() },
    annotations: read,
  }, run(async (args) => {
    const accountId = await accountOf(args);
    const bank = await store.getBank(args.bank_id);
    if (!bank || bank.accountId !== accountId) throw new GameError('Bank not found.');
    return { ...banks.summary(bank), items: bank.items };
  }));

  server.registerTool('add_seen_questions', {
    title: 'أضف أسئلة «سين جيم»',
    description: 'Add questions to a «سين جيم» bank (one board category). value is 200 (easy), 400 or 600 (hard). Ready to play with 2+ questions of each value.',
    inputSchema: {
      ...target,
      questions: z.array(z.object({
        value: z.union([z.literal(200), z.literal(400), z.literal(600)]),
        q: z.string().max(200).describe('The question'),
        a: z.string().max(80).describe('The short answer'),
        ...picture,
      })).min(1).max(banks.LIMITS.perCall),
    },
    annotations: write,
  }, add('seen', 'questions'));

  server.registerTool('add_letters_questions', {
    title: 'أضف أسئلة «حروف»',
    description: 'Add questions to a «حروف» bank. The answer must start with an Arabic letter (a leading «ال» is skipped); that letter is where the question goes. Spread the questions over many letters.',
    inputSchema: {
      ...target,
      questions: z.array(z.object({ q: z.string().max(200), a: z.string().max(80) })).min(1).max(banks.LIMITS.perCall),
    },
    annotations: write,
  }, add('letters', 'questions'));

  server.registerTool('add_herd_questions', {
    title: 'أضف أسئلة «عقلية القطيع»',
    description: 'Add prompts to a «عقلية القطيع» bank. mode "same": open prompts where everyone tries to match the majority. mode "different": prompts with a limited set of valid answers where each tries to be the only one with their answer. No answers needed.',
    inputSchema: {
      ...target,
      questions: z.array(z.object({ mode: z.enum(['same', 'different']), q: z.string().max(200) })).min(1).max(banks.LIMITS.perCall),
    },
    annotations: write,
  }, add('herd', 'questions'));

  server.registerTool('add_outsider_words', {
    title: 'أضف كلمات «برا السالفة»',
    description: 'Add words to a «برا السالفة» bank (one category, e.g. places or foods). Concrete, well-known nouns. Ready with 4+ words; 20+ is better.',
    inputSchema: { ...target, words: z.array(z.string().max(30)).min(1).max(banks.LIMITS.perCall) },
    annotations: write,
  }, add('outsider', 'words', (words) => words.map((word) => ({ word }))));

  server.registerTool('add_time_cards', {
    title: 'أضف بطاقات «تحدي الوقت»',
    description: 'Add cards to a «تحدي الوقت» bank (one wheel category). type "emoji": face is emoji only. type "text": face is a short clue. type "image": a picture (image_url or image_base64). Ready with 15+ cards.',
    inputSchema: {
      ...target,
      cards: z.array(z.object({
        type: z.enum(['emoji', 'text', 'image']),
        face: z.string().max(80).optional().describe('Emoji or short text (not for image cards)'),
        answer: z.string().max(80),
        ...picture,
      })).min(1).max(banks.LIMITS.perCall),
    },
    annotations: { ...write, openWorldHint: true },
  }, add('time', 'cards'));

  server.registerTool('remove_from_bank', {
    title: 'احذف من بنك',
    description: 'Remove items from a bank by their ids (see get_bank).',
    inputSchema: { ...linkArg, bank_id: z.number().int().positive(), item_ids: z.array(z.number().int().positive()).min(1) },
    annotations: { ...write, destructiveHint: true },
  }, run(async (args) => banks.removeItems(store, await accountOf(args), args.bank_id, args.item_ids)));

  server.registerTool('delete_bank', {
    title: 'احذف بنك',
    description: 'Delete a whole bank and its pictures. Ask the user first.',
    inputSchema: { ...linkArg, bank_id: z.number().int().positive() },
    annotations: { ...write, destructiveHint: true },
  }, run(async (args) => banks.deleteBank(store, await accountOf(args), args.bank_id)));

  return server;
}

/** Express handler for POST /mcp (after the bearer-token check). */
function mcpHandler({ accountsReady, content, baseUrl }) {
  return async (req, res) => {
    try {
      const store = await accountsReady;
      const server = buildServer({ grantAccountId: req.auth.extra.accountId, clientId: req.auth.clientId, store, content, baseUrl });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp]', err);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  };
}

module.exports = { mcpHandler, guideText };
