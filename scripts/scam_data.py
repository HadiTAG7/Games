#!/usr/bin/env python3
"""«مين النصاب؟»: the impostor's secret missions and the punishment wheel. Running
this file checks them and writes data/scam.json:

    python3 scripts/scam_data.py

The words are «برا السالفة»'s (data/outsider.json). Everyone gets the word except
the impostor, who instead gets a mission to carry out out loud during the round
without anyone noticing. A mission is something a seated player can do while
talking: say a word a few times, ask something, react in a certain way. At the
vote, everyone picks the mission they think it was from six (the real one and five
others), so missions must read differently from each other.

The loser of the game spins the punishment wheel. A punishment is light and
friendly, done right there at the gathering: nothing humiliating, nothing about
looks, no money, no food or drink tricks, and nothing religious. `short` is the
label on the wheel (one or two words); `text` is the full punishment.

Ids m01…, p01… are given in order when the JSON is written.
"""

import json
import pathlib
import re

MISSIONS = [
  "قل كلمة «نقانيش» ثلاث مرات",
  "دخّل خمس كلمات إنجليزية في كلامك",
  "امدح لبس واحد من الشلة",
  "اسأل أحد: كم الساعة؟",
  "كرر آخر كلمة قالها اللي قبلك",
  "اضحك بصوت عالي مرتين بدون سبب",
  "قل «يا سلام» ثلاث مرات",
  "صفّق مرة وحدة بدون سبب",
  "اذكر اسم أكلة وأنت تتكلم عن شي ثاني",
  "نادِ واحد من الشلة باسم غلط",
  "قل «تذكرون؟» وكأنك تتذكر سالفة قديمة",
  "اسأل سؤال وجاوب عليه بنفسك",
  "قل «صح لسانك» لثلاثة أشخاص",
  "اعطس عطسة مزيفة",
  "قل رقم بدون مناسبة مرتين",
  "اذكر اسم دولة في كلامك ثلاث مرات",
  "قل «بالضبط!» أربع مرات",
  "قم من مكانك وارجع",
  "حط يدك على راسك مرتين",
  "قل كلمة «بطاطس» في جملة",
  "دندن لحن بصوت واطي",
  "قل «أنا النصاب» في أول الجولة كأنك تمزح",
  "اتهم واحد إنه النصاب بدون سبب",
  "دافع عن واحد بقوة وقل إنه أكيد مو النصاب",
  "ابدأ جملتين بـ«والحين…»",
  "تكلم بالفصحى في جملتين",
  "قلّد صوت واحد من الشلة مرة",
  "اسأل: «وش رايكم نطلب أكل؟»",
  "قل كلمة «فراولة» مرتين",
  "سلّم على أحد كأنك أول مرة تشوفه",
  "قل «يعطيك العافية» لثلاثة أشخاص",
  "اسأل أحد عن نوع جواله",
  "قل «اسمعوا اسمعوا» قبل ما تتكلم مرتين",
  "غيّر نبرة صوتك فجأة في جملة",
  "اذكر اسم حيوان ثلاث مرات",
  "قل «أكيد أكيد» مرتين",
  "اسأل: «مين اختار الكلمة هذي؟»",
  "قل «هذي سهلة!» بصوت عالي",
  "قل «ريّحوني» مرتين",
  "اذكر اسم لاعب كورة في كلامك",
  "اذكر اسم مدينة سعودية مرتين",
  "قل «وش قلت؟» لأحد مرتين",
  "قل «تراني فاهمها» بثقة",
  "ابدأ ثلاث جمل بـ«شوفوا»",
  "اسأل أحد: وش أكلت اليوم؟",
  "قل «هههه» بصوتك بدل ما تضحك",
  "سوّ علامة النصر بيدك مرتين",
  "قل «يمكن أنا النصاب» وأنت تضحك",
  "اقترح نغيّر قوانين اللعبة",
  "قل «لحظة لحظة» ثلاث مرات",
  "احسب على أصابعك بصوت عالي",
  "اذكر اسم لون ثلاث مرات",
  "اسأل: «كم باقي على التصويت؟»",
  "قل «أنا أعرف مين النصاب» بثقة",
  "امدح الكلمة: «كلمة حلوة الصراحة»",
  "قل «مستحيل!» مرتين",
  "اسأل أحد وش لونه المفضل",
  "قل «من جدك؟» لاثنين من الشلة",
]

PUNISHMENTS = [
  ("تقليد", "قلّد صوت حيوان تختاره الشلة"),
  ("فصحى", "تكلّم بالفصحى لين اللعبة الجاية"),
  ("نكتة", "قل نكتة، ولو ما ضحكوا تعيدها"),
  ("مدح", "امدح كل واحد في الشلة بجملة"),
  ("تمثيل", "مثّل مشهد من مسلسل مشهور والشلة يخمّنون"),
  ("مذيع", "اقرأ أخبار الشلة كأنك مذيع نشرة"),
  ("بطء", "تكلّم ببطء شديد لين الجولة الجاية"),
  ("همس", "تكلّم بالهمس لين الجولة الجاية"),
  ("ضيافة", "صبّ القهوة أو الشاي للكل"),
  ("إعلان", "سوّ إعلان لشي يختاره الفائز"),
  ("شعر", "قل بيتين شعر من تأليفك عن الشلة"),
  ("لهجة", "تكلّم بلهجة غير لهجتك لين الجولة الجاية"),
  ("روبوت", "تكلّم مثل الروبوت دقيقتين"),
  ("ابتسامة", "خلّك مبتسم دقيقة كاملة مهما صار"),
  ("بالمقلوب", "قل أسماء الشلة بالمقلوب"),
  ("حروف", "قل الحروف الهجائية بأسرع ما تقدر"),
  ("معلّق", "علّق على اللي يصير حولك كأنها مباراة دقيقة"),
  ("سالفة", "احكِ موقف طريف صار لك"),
  ("أستاذ", "اشرح شي بسيط كأنك أستاذ في فصل"),
  ("صدى", "كرر آخر كلمة يقولها أي أحد لين الجولة الجاية"),
  ("ممنوع لا", "ممنوع تقول «لا» لين اللعبة الجاية"),
  ("سكوت", "اسكت دقيقتين كاملة"),
  ("ضحكة", "اضحك ضحكة شرير مرتين"),
  ("طباخ", "اشرح وصفة أكلة خطوة خطوة بأسلوب طباخ"),
  ("مرآة", "قلّد حركات واحد من الشلة دقيقة"),
  ("خطاب", "ألقِ خطاب فوز كأنك فزت بجائزة"),
  ("قصة", "ألّف قصة قصيرة فيها أسماء الشلة كلهم"),
  ("رسام", "ارسم واحد من الشلة والباقين يخمّنون مين"),
  ("لقب", "الشلة تختار لك لقب وينادونك فيه لين آخر السهرة"),
  ("تمارين", "سوّ عشر تمارين قرفصاء"),
  ("لغز", "اطرح لغز على الشلة، ولو ما حلّوه تسلم من العقاب الجاي"),
  ("مترجم", "ترجم كلام اللي يتكلم للإنجليزي دقيقة"),
  ("شكر", "اشكر كل واحد في الشلة على شي سوّاه لك"),
  ("مقابلة", "عرّف بنفسك كأنك في مقابلة وظيفة"),
  ("المضيف", "أنت المضيف في اللعبة الجاية"),
  ("صوت عالي", "قل جملتك الجاية بأعلى صوت عندك"),
]

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "scam.json"
LATIN = re.compile(r"[A-Za-z]")
MAX_MISSION = 60
MAX_SHORT = 10
MAX_TEXT = 70


def check():
    problems = []
    if len(set(MISSIONS)) != len(MISSIONS):
        problems.append("a mission is listed twice")
    for i, text in enumerate(MISSIONS, 1):
        if not text.strip() or len(text) > MAX_MISSION:
            problems.append(f"mission {i}: empty or longer than {MAX_MISSION} characters")
        if LATIN.search(text):
            problems.append(f"mission {i}: has Latin letters")
    if len(MISSIONS) < 6:
        problems.append("the vote needs at least six missions to choose from")
    shorts = [s for s, _ in PUNISHMENTS]
    if len(set(shorts)) != len(shorts):
        problems.append("two punishments share a wheel label")
    for i, (short, text) in enumerate(PUNISHMENTS, 1):
        if not short.strip() or len(short) > MAX_SHORT:
            problems.append(f"punishment {i}: label empty or longer than {MAX_SHORT} characters")
        if not text.strip() or len(text) > MAX_TEXT:
            problems.append(f"punishment {i}: text empty or longer than {MAX_TEXT} characters")
    if len(PUNISHMENTS) < 8:
        problems.append("the wheel needs at least eight punishments")
    return problems


def main():
    problems = check()
    if problems:
        raise SystemExit("scam_data.py: problems:\n" + "\n".join(problems))
    data = {
        "missions": [{"id": f"m{i:02d}", "text": text} for i, text in enumerate(MISSIONS, 1)],
        "punishments": [{"id": f"p{i:02d}", "short": short, "text": text} for i, (short, text) in enumerate(PUNISHMENTS, 1)],
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(MISSIONS)} missions and {len(PUNISHMENTS)} punishments written to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
