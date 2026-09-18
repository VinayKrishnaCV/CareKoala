"""Build the CareKoala danger-scoring dataset (train / val / test JSONL).

Every source is mapped onto ONE 0-10 danger scale (see RUBRIC below), then a share of
examples is rewritten to look like real OCR output from a screen: surrounded by app UI
text, mixed with harmless snippets, and corrupted with OCR-style character errors.

    python training/build_dataset.py            # writes data/processed/{train,val,test}.jsonl
"""
import ast
import html
import json
import random
import re
from pathlib import Path

import pandas as pd

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "engine"))
from prompt import MAX_TEXT_CHARS, clip_text  # noqa: E402  (shared with the runtime engine)

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
OUT = Path(__file__).resolve().parent.parent / "data" / "processed"
SEED = 1234

RUBRIC = """
0     safe: normal content (news, study, code, chat, shopping, UI)
1     safe: everyday negativity, casual swearing, frustration
2-3   distress / mild harassment: sadness, stress, rude or insulting language
4-5   hateful or abusive language, cyberbullying, depressive content with risk indicators
6-7   extreme hate, dehumanisation, calls for violence, passive death wish ("I wish I was dead")
8     active suicidal ideation ("I want to kill myself"), searches for methods
9     suicidal ideation with intent / preparation
10    suicide plan with intent, or an attempt in progress / described
"""

SELF_HARM_RE = re.compile(
    r"\b(kill(ing)? my ?self|suicid\w*|end(ing)? (it|my life|things)|want(ed)? to die|wanna die|"
    r"overdos\w*|\bOD\b|pills|cut(ting)? my|slit|hang(ing)? myself|jump(ing)? off|not (be )?alive|"
    r"better off dead|take my (own )?life|don'?t want to (live|be here|exist))",
    re.I,
)
# Telling someone to kill / hurt themselves ("kys", "go die", "drink bleach") - v2 addition.
DIRECTED_SELF_HARM_RE = re.compile(
    r"\b(kys|kill (your ?self|urself|yo self|yourselves)|go (die|kill yourself)|neck yourself|hang yourself|drink bleach|"
    r"slit your wrists?|nobody would (care|miss you) if you died|you should (just )?die|end your(self| life)|"
    r"do (us|the world) a favou?r and die)\b", re.I)
REPORTED_RE = re.compile(r"\b(got|get|getting|told me( to)?|said) (kys|kill (my|your) ?self)", re.I)
# First-person self-injury acts (cutting, burning, relapse) - v2 addition.
SELF_INJURY_RE = re.compile(
    r"\b(i (just |have |ve |had )?(cut|burn(ed|t)?|scratch(ed)?) (myself|my (arms?|wrists?|legs?|thighs?|stomach|hips?))|"
    r"cut myself|cutting myself|cutting again|started cutting|i relapsed|relapsed (again|last night|today)|"
    r"self ?harm(ed)? (again|last night|today)|my (fresh )?cuts|new cuts|cuts (are|were) (deep|bleeding)|"
    r"(razor|blade|sharpener)s?\b.*\b(cut|arm|wrist|thigh))", re.I)
CUT_WORDS_RE = re.compile(r"\b(cut|cutting|blade|razor|scars?|burn(ed|t)?|bleed(ing)?)\b", re.I)
SEXUAL_SPAM_RE = re.compile(r"\b(porn|xxx|nsfw|anal|nude|nudes|blowjob|horny|pussy|cock|onlyfans)\b", re.I)


def clean(t: str) -> str:
    t = html.unescape(str(t))
    t = re.sub(r"https?://\S+", "URL", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def rec(text, score, category, source):
    return {"text": clean(text), "score": int(score), "category": category, "source": source}


def focus(text, pattern=SELF_HARM_RE, limit=MAX_TEXT_CHARS):
    """Long posts get clipped; make sure the sentence that earned the risk label survives."""
    m = pattern.search(text)
    if len(text) <= limit or not m or m.end() < limit - 80:
        return text
    start = max(0, m.start() - 200)
    start = text.find(" ", start) + 1 if start else 0
    return text[start:]


# ----------------------------------------------------------------------------- sources
def measuring_hate_speech():
    """UC Berkeley D-Lab Measuring Hate Speech (listed on hatespeechdata.com).

    hate_speech_score is an IRT severity score for identity-based hate; plain insults and
    threats are captured by the per-item ratings (0-4), so both are combined here.
    """
    d = pd.read_parquet(RAW / "measuring_hate_speech.parquet")
    g = d.groupby("comment_id").agg(
        text=("text", "first"), hs=("hate_speech_score", "first"), insult=("insult", "mean"),
        humiliate=("humiliate", "mean"), violence=("violence", "mean"), genocide=("genocide", "mean"),
    )
    pools = {"mhs_safe": [], "mhs_harass": [], "mhs_hate": [], "mhs_violence": []}
    for r in g.itertuples():
        if r.hs >= 3.0: s = 7
        elif r.hs >= 2.0: s = 6
        elif r.hs >= 1.0: s = 5
        elif r.hs >= 0.3: s = 4
        elif r.hs >= -1.0: s = 2
        else: s = 0
        worst = max(r.insult, r.humiliate)
        s = max(s, 5 if worst >= 3.5 else 4 if worst >= 2.8 else 3 if worst >= 2.0 else 1 if worst >= 1.2 else 0)
        if r.violence >= 3.0 or r.genocide >= 3.0:
            s, cat, pool = max(s, 8 if r.hs >= 2.5 else 7), "violence", "mhs_violence"
        elif s <= 1:
            cat, pool = "safe", "mhs_safe"
            if SEXUAL_SPAM_RE.search(r.text):
                continue  # porn spam is out of scope; don't teach the model it is "safe"
        elif r.hs >= 0.3:
            cat, pool = "hate_speech", "mhs_hate"
        else:
            cat, pool = "harassment", "mhs_harass"
        pools[pool].append(directed(rec(r.text, s, cat, pool)))
    return pools


def cyberbullying():
    """Cyberbullying tweets (Wang et al. 2020, CB1). Labels are noisy, so used lightly."""
    d = pd.concat([pd.read_parquet(RAW / "cyberbullying_train.parquet"), pd.read_parquet(RAW / "cyberbullying_test.parquet")])
    pools = {"cb_not": [], "cb_hate": [], "cb_age": []}
    for t, y in zip(d.tweet_text, d.cyberbullying_type):
        if y == "not_cyberbullying":
            pools["cb_not"].append(directed(rec(t, 0, "safe", "cb_not")))
        elif y in ("gender", "religion", "ethnicity"):
            pools["cb_hate"].append(directed(rec(t, 4, "hate_speech", "cb_hate")))
        elif y == "age":  # mostly people recounting being bullied at school
            pools["cb_age"].append(directed(rec(t, 3, "harassment", "cb_age")))
    return pools


def indo_hatespeech():
    """Indo-HateSpeech: Hindi-English code-mixed Instagram comments (Mendeley snc7mxpj6t)."""
    d = pd.read_excel(RAW / "indo_hatespeech.xlsx")
    pools = {"indo_hs0": [], "indo_hs1": [], "indo_hsn": []}
    for t, y in zip(d.Comment.fillna("").astype(str), d.Label.fillna("").astype(str).str.strip("'")):
        if len(re.findall(r"\w{2,}", t)) < 3:
            continue  # emoji-only / @mention-only comments
        if y == "HS0":
            pools["indo_hs0"].append(rec(t, 0, "safe", "indo_hs0"))
        elif y == "HS1":
            pools["indo_hs1"].append(rec(t, 4, "hate_speech", "indo_hs1"))
        elif y == "HSN":
            pools["indo_hsn"].append(rec(t, 6, "hate_speech", "indo_hsn"))
    return pools


def cssrs_posts():
    """r/SuicideWatch posts labelled on the Columbia Suicide Severity Rating Scale (0-6)."""
    d = pd.read_csv(RAW / "cssrs_suicidewatch_posts.csv")
    to_score = {0: 3, 1: 7, 2: 8, 3: 8, 4: 9, 5: 10, 6: 10}
    pools = {"cssrs_low": [], "cssrs_risk": []}
    for t, sev in zip(d.content.fillna("").astype(str), d.severity):
        if sev == 0:
            pools["cssrs_low"].append(rec(t, 3, "distress", "cssrs_low"))
        else:
            pools["cssrs_risk"].append(rec(focus(clean(t)), to_score[int(sev)], "self_harm", "cssrs_risk"))
    return pools


def parse_post_list(s):
    """Posts are stored as a Python list literal; long ones were cut at Excel's 32767-char limit."""
    try:
        return ast.literal_eval(s)
    except (SyntaxError, ValueError):
        parts = re.split(r"""['"],\s*['"]""", s.strip().lstrip("[").lstrip("'\""))
        return parts[:-1]  # the last post is the truncated one


def cssrs_users():
    """Reddit C-SSRS dataset (Gaur et al. 2019): 500 users with user-level risk labels."""
    d = pd.read_csv(RAW / "reddit_cssrs_500users.csv")
    to_score = {"Supportive": 2, "Indicator": 5, "Ideation": 8, "Behavior": 9, "Attempt": 10}
    rng = random.Random(SEED)
    pools = {"cssrs_users_low": [], "cssrs_users_risk": []}
    for user, posts, label in zip(d.User, d.Post, d.Label):
        posts = [p for p in parse_post_list(posts) if len(p) > 60]
        s = to_score[label]
        if s >= 8:  # the label is per user: keep only posts that themselves express risk
            posts = [p for p in posts if SELF_HARM_RE.search(p)]
            pool, cat = "cssrs_users_risk", "self_harm"
        else:
            pool, cat = "cssrs_users_low", "distress"
        for p in rng.sample(posts, min(2, len(posts))):
            r = rec(focus(clean(p)) if s >= 8 else p, s, cat, pool)
            r["group"] = user  # keep a user's posts in the same split
            pools[pool].append(r)
    return pools


def suicide_prediction():
    """r/SuicideWatch vs r/teenagers (stopwords removed by the publisher) - used sparingly."""
    d = pd.read_parquet(RAW / "suicide_prediction.parquet")
    pools = {"sp_suicide": [], "sp_non": []}
    for t, y in zip(d.text, d.label):
        if y == "suicide" and SELF_HARM_RE.search(t):
            pools["sp_suicide"].append(rec(focus(t), 8, "self_harm", "sp_suicide"))
        elif y == "non-suicide":
            pools["sp_non"].append(rec(t, 1, "safe", "sp_non"))
    return pools


def emotion():
    """dair-ai/emotion: teaches that ordinary sadness is NOT a crisis."""
    d = pd.read_parquet(RAW / "emotion_train.parquet")
    pools = {"emo_pos": [], "emo_anger": [], "emo_sad": []}
    for t, y in zip(d.text, d.label):
        if y in (0, 4):  # sadness, fear
            pools["emo_sad"].append(rec(t, 2, "distress", "emo_sad"))
        elif y == 3:
            pools["emo_anger"].append(rec(t, 1, "safe", "emo_anger"))
        else:
            pools["emo_pos"].append(rec(t, 0, "safe", "emo_pos"))
    return pools


def directed(r):
    """v2: someone being told to kill/hurt themselves is an alert (7), whatever the hate score said.

    The record stays in its original pool so train/val/test membership is unchanged.
    """
    if DIRECTED_SELF_HARM_RE.search(r["text"]) and not REPORTED_RE.search(r["text"]):
        if r["score"] < 7:
            r.update(score=7, category="harassment")
        r.update(source="kys_" + r["source"], directed=True)
    return r


def self_injury():
    """v2: non-suicidal self-injury. sivasothy-Tharsi/self-harm-detection (Reddit, no licence stated):
    'self-harm' posts that describe a first-person act (cutting, burning, relapse) in the opening
    text -> 8; 'non-self-harm' posts that merely use words like cut/blade/scar -> 1 (hard negatives)."""
    d = pd.read_parquet(RAW / "selfharm_detection.parquet", columns=["text", "class"])
    pools = {"nssi": [], "nssi_neg": []}
    for t, y in zip(d.text.fillna("").astype(str), d["class"]):
        if y == "self-harm":
            m = SELF_INJURY_RE.search(t)
            if m and m.start() < 420:
                pools["nssi"].append(rec(t, 8, "self_harm", "nssi"))
        else:
            m = CUT_WORDS_RE.search(t)
            if m and m.start() < 400 and not SELF_INJURY_RE.search(t):
                pools["nssi_neg"].append(rec(t, 1, "safe", "nssi_neg"))
    return pools


def benign_articles():
    news = pd.read_parquet(RAW / "ag_news_test.parquet").text
    wiki = pd.concat([pd.read_parquet(RAW / f) for f in ["wikitext2_test.parquet", "wikitext2_val.parquet"]]).text
    fix = [(" @-@ ", "-"), (" @,@ ", ","), (" @.@ ", "."), (" , ", ", "), (" . ", ". "), (" 's", "'s"), (" ( ", " ("), (" ) ", ") ")]
    paras = []
    for w in wiki:
        w = w.strip()
        if len(w) > 250 and not w.startswith("="):
            for a, b in fix:
                w = w.replace(a, b)
            paras.append(w)
    return {
        "news": [rec(t, 0, "safe", "news") for t in news],
        "wiki": [rec(t, 0, "safe", "wiki") for t in paras],
    }


# ---------------------------------------------------------- screen / OCR simulation
NAMES = ["Aarav", "Diya", "Rohan", "Priya", "Sam", "Alex", "Maya", "Kabir", "Emma", "Liam", "Zoya", "Arjun", "Noah", "Ananya"]
CHROME = {
    "browser": ["New Tab", "Search Google or type a URL", "Bookmarks", "{site}", "Sign in", "Images", "Videos", "News", "Settings", "Tools", "About 1,20,000 results (0.41 seconds)"],
    "social": ["Home", "Explore", "Notifications", "Messages", "Reply", "Like", "Share", "Follow", "@{handle}", "{n}h", "View {n} more replies", "Trending", "Post", "Retweet", "{n}K likes"],
    "chat": ["WhatsApp", "Type a message", "online", "{name}", "{hh}:{mm} PM", "Today", "Yesterday", "last seen today at {hh}:{mm}", "Voice call", "Search"],
    "youtube": ["YouTube", "Subscribe", "{n}M views", "{n} years ago", "Comments {n}K", "Sort by", "Add a comment...", "Up next", "Autoplay", "Shorts"],
    "discord": ["# general", "# memes", "Online — {n}", "Message #general", "{name}", "Today at {hh}:{mm}", "Voice Connected", "Server Boost"],
    "os": ["Activities", "Wi-Fi", "{n}%", "File  Edit  View  Window  Help", "Mon {d} Sep {hh}:{mm}", "Downloads", "Recycle Bin", "Start"],
    "code": ["def main():", "import os", "TERMINAL  PROBLEMS  OUTPUT", "git commit -m \"fix\"", "return result", "npm run dev", "Ln {n}, Col {n}", "for i in range(n):", "kill -9 {n}"],
}
SITES = ["www.reddit.com/r/teenagers", "twitter.com/home", "www.instagram.com", "www.youtube.com/watch", "web.whatsapp.com", "discord.com/channels", "www.google.com/search"]

# Everyday text that contains "dangerous" words but is harmless - the classic false positives.
HARD_NEGATIVES = [
    "Terminal: kill -9 4312 to stop the stuck process, then restart the server.",
    "lmao I'm dead 💀 this meme is killing me",
    "Suicide Squad (2016) - Rotten Tomatoes - Critics Consensus",
    "My phone battery is dying, text you later",
    "Headshot! Double kill! Victory Royale 🏆",
    "This chemistry exam is going to be the death of me haha",
    "How to kill a child process in Python - Stack Overflow",
    "The protagonist dies at the end of the novel, which shocked readers.",
    "Chapter 7: The French Revolution and the Reign of Terror",
    "Git: how do I cut a release branch and squash commits?",
    "Tonight's episode: the detective investigates a murder at the manor.",
    "I could die for a plate of biryani right now",
    "Documentary: The history of World War II in colour",
    "Pesticides kill 99.9% of garden pests - buy now",
    "Assignment due tomorrow, I'm so dead if I don't finish lol",
    "First aid: how to treat a cut or scrape at home",
    "Mental health awareness week: talking helps. Reach out to friends and family.",
    "Hamlet Act 3: To be, or not to be, that is the question",
    "Our cat knocked the plant over again 😂",
    "Workout complete: 5 km run, 30 push-ups. Legs are killing me!",
]
# Screens that only appear after searching for suicide methods (e.g. Google's crisis banner).
CRISIS_SEARCHES = [
    ("how to kill myself painlessly", 10), ("easiest way to die", 10), ("how many pills to overdose", 10),
    ("how deep to cut wrists", 10), ("i want to die", 8), ("is it selfish to kill myself", 9),
    ("painless ways to end my life", 10), ("will anyone miss me if i die", 8), ("how to write a suicide note", 10),
]
CRISIS_BANNER = [
    "Help is available", "Speak with someone today", "988 Suicide and Crisis Lifeline",
    "Tele MANAS 14416", "Call  Text  Chat", "Languages: English, Hindi",
]


def fill(s, rng):
    return s.format(site=rng.choice(SITES), handle=rng.choice(NAMES).lower() + str(rng.randint(1, 999)), n=rng.randint(1, 99), d=rng.randint(1, 28),
                    name=rng.choice(NAMES), hh=rng.randint(1, 12), mm=f"{rng.randint(0, 59):02d}")


def chrome_lines(rng, k=None):
    app = rng.choice(list(CHROME))
    return [fill(rng.choice(CHROME[app]), rng) for _ in range(k or rng.randint(2, 6))]


def screenify(r, rng, safe_pool):
    """Wrap an example in UI text and optionally a second harmless snippet (label = worst part).

    Extra text is budgeted so the labelled snippet is never pushed past the clip limit.
    """
    top, bottom = chrome_lines(rng), chrome_lines(rng, rng.randint(0, 3))
    extra = [rng.choice(safe_pool)["text"][:150]] if rng.random() < 0.4 else []
    budget = MAX_TEXT_CHARS - sum(len(x) + 1 for x in top + bottom + extra)
    if budget < 120:
        top, bottom, extra = top[:2], [], []
        budget = MAX_TEXT_CHARS - sum(len(x) + 1 for x in top)
    parts = [clip_text(r["text"], budget)]
    if extra:
        parts.insert(rng.randint(0, 1), extra[0])
    return {**r, "text": "\n".join(top + parts + bottom), "source": r["source"] + "+screen"}


OCR_SWAPS = [("l", "1"), ("I", "l"), ("O", "0"), ("rn", "m"), ("m", "rn"), ("e", "c"), ("a", "o"), ("i", "l"), ("S", "5"), ("t", "f")]


def ocr_noise(text, rng, rate=None):
    rate = rate if rate is not None else rng.uniform(0.01, 0.05)
    out = []
    for w in re.split(r"(\s+)", text):
        if w.strip() and rng.random() < rate * 3:
            a, b = rng.choice(OCR_SWAPS)
            w = w.replace(a, b, 1)
        if w.isspace() and rng.random() < rate:
            w = rng.choice(["", "\n", "  "])
        out.append(w)
    t = "".join(out)
    if rng.random() < 0.3:  # OCR engines often drop punctuation / apostrophes
        t = re.sub(r"[’'`]", "", t)
    return t


def synthetic(rng, n_ui, n_hardneg, n_crisis):
    out = []
    for _ in range(n_ui):
        out.append(rec("\n".join(chrome_lines(rng, rng.randint(4, 10))), 0, "safe", "synth_ui"))
    for _ in range(n_hardneg):
        out.append(rec("\n".join(chrome_lines(rng) + [rng.choice(HARD_NEGATIVES)] + chrome_lines(rng, 2)), rng.choice([0, 0, 1]), "safe", "synth_hardneg"))
    for _ in range(n_crisis):
        q, s = rng.choice(CRISIS_SEARCHES)
        lines = ["Google", q] + rng.sample(CRISIS_BANNER, rng.randint(2, 5)) + chrome_lines(rng, 3)
        out.append(rec("\n".join(lines), s, "self_harm", "synth_crisis"))
    # Crisis banner on an awareness page, no search query visible
    for _ in range(max(1, n_crisis // 4)):
        lines = ["World Suicide Prevention Day: know the warning signs and how to support friends."] + rng.sample(CRISIS_BANNER, 3)
        out.append(rec("\n".join(lines), 3, "distress", "synth_awareness"))
    return out


# ----------------------------------------------------------------------------- build
# Examples drawn per pool for the TRAIN split (val/test get their own share of each pool).
TRAIN_QUOTA = {
    "news": 200, "wiki": 160, "emo_pos": 160, "emo_anger": 70, "cb_not": 200, "mhs_safe": 300, "indo_hs0": 250, "sp_non": 120,
    "emo_sad": 300, "cssrs_low": 400, "cssrs_users_low": 300,
    "cssrs_risk": 800, "cssrs_users_risk": 400, "sp_suicide": 250,
    "mhs_harass": 300, "mhs_hate": 420, "mhs_violence": 220, "cb_hate": 240, "cb_age": 80, "indo_hs1": 200, "indo_hsn": 170,
    # v2 additions (pools come last so every v1 pool keeps its exact split)
    "nssi": 450, "nssi_neg": 200,
}


def split_pool(items, rng):
    """80/10/10 split; posts from the same user stay together."""
    groups = {}
    for r in items:
        groups.setdefault(r.get("group") or r["text"], []).append(r)
    keys = list(groups)
    rng.shuffle(keys)
    n = len(keys)
    cut1, cut2 = int(n * 0.8), int(n * 0.9)
    pick = lambda ks: [r for k in ks for r in groups[k]]  # noqa: E731
    return pick(keys[:cut1]), pick(keys[cut1:cut2]), pick(keys[cut2:])


def main():
    rng = random.Random(SEED)
    pools = {}
    for fn in [measuring_hate_speech, cyberbullying, indo_hatespeech, cssrs_posts, cssrs_users, suicide_prediction, emotion, benign_articles,
               self_injury]:
        pools.update(fn())
        print(f"loaded {fn.__name__}")

    splits = {"train": [], "val": [], "test": []}
    extras = {"train": [], "val": [], "test": []}  # all "kys" examples, not just the sampled share
    seen = set()
    for name, items in pools.items():
        uniq = []
        for r in items:
            key = r["text"].lower()[:200]
            if len(r["text"]) >= 12 and key not in seen:
                seen.add(key)
                r["text"] = clip_text(r["text"])
                uniq.append(r)
        tr, va, te = split_pool(uniq, rng)
        q = TRAIN_QUOTA[name]
        picked = {"train": rng.sample(tr, min(q, len(tr))), "val": rng.sample(va, min(max(8, q // 12), len(va))),
                  "test": rng.sample(te, min(max(20, q // 6), len(te)))}
        for part, full in (("train", tr), ("val", va), ("test", te)):
            splits[part] += picked[part]
            ids = {id(r) for r in picked[part]}
            extras[part] += [r for r in full if r.get("directed") and id(r) not in ids]
        print(f"  {name:18s} available={len(uniq):6d}  train={min(q, len(tr)):4d}")

    for part in splits:  # appended after every pool so v1 rows keep their order (and augmentation)
        splits[part] += extras[part]
    print("  directed self-harm encouragement (kys) kept:", {k: sum(r.get("directed", False) for r in v) for k, v in splits.items()})

    for name, n_ui, n_hn, n_cr in [("train", 90, 140, 70), ("val", 6, 10, 6), ("test", 20, 30, 18)]:
        splits[name] += synthetic(random.Random(f"{SEED}{name}"), n_ui, n_hn, n_cr)

    for name, rows in splits.items():
        srng = random.Random(f"aug{name}")
        safe_pool = [r for r in rows if r["score"] == 0]
        out = []
        for r in rows:
            if not r["source"].startswith("synth") and srng.random() < 0.35:
                r = screenify(r, srng, safe_pool)
            if srng.random() < 0.3:
                r = {**r, "text": ocr_noise(r["text"], srng)}
            r["text"] = clip_text(r["text"])
            out.append(r)
        srng.shuffle(out)
        OUT.mkdir(parents=True, exist_ok=True)
        with open(OUT / f"{name}.jsonl", "w") as f:
            for r in out:
                f.write(json.dumps({k: r[k] for k in ("text", "score", "category", "source")}, ensure_ascii=False) + "\n")
        dist = pd.Series([r["score"] for r in out]).value_counts().sort_index().to_dict()
        cats = pd.Series([r["category"] for r in out]).value_counts().to_dict()
        print(f"{name}: {len(out)} examples\n  scores {dist}\n  categories {cats}")


if __name__ == "__main__":
    main()
