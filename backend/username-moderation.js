/**
 * Username Moderation Engine (`backend/username-moderation.js`)
 * Deterministic pure-function engine for offensive language & obfuscation detection.
 * Zero external dependencies. CRLF line endings.
 */
"use strict";

const ALLOWLIST = new Set([
  // English words with Scunthorpe / innocent substrings
  "pass", "compass", "cassette", "classic", "classical", "glass", "grass", "bass", "asset", "assets",
  "assemble", "assembly", "assume", "assist", "assistant", "associate", "association", "class", "classes",
  "cockburn", "hitchcock", "peacock", "cockatoo", "cockpit",
  "dickens", "dickinson", "benedick",
  "document", "documentation", "accumulate", "cumulus", "cucumber",
  "titular", "attitude", "entity", "entities", "substitute", "constitution", "appetite", "competitor",
  "butt", "button", "butter", "butterfly", "butler",
  "hello", "shell", "shelter",
  "therapist", "therapy",
  "basement", "ambassador", "embassy", "mass", "massive", "passion", "passport", "brass",

  // Egyptian / Arabic names & words with potentially sensitive roots
  "kholy", "elkholy", "el-kholy", "alkholy", "al-kholy", "khawly", "elkhawly",
  "kassab", "elkassab", "kassar", "kasser", "kassem", "elkassem", "inikas",
  "nicholas", "nicole", "technique", "technical", "techno", "mechanic", "mechanical",
  "sharm", "sharm-el-sheikh", "sharmelsheikh",
  "mounir", "monir", "manar",
  "zubaida", "zubaidah", "zebda",

  // Common Egyptian first & family names
  "ahmed", "mohamed", "muhammad", "mohammed", "mahmoud", "mostafa", "mustafa", "tarek", "tariq", "tareq",
  "kareem", "karim", "youssef", "yousef", "joseph", "omar", "amr", "ali", "aly", "hassan", "hasan",
  "hussein", "hossam", "ibrahim", "khaled", "zeyad", "ziad", "nour", "nourhan", "sarah", "sara",
  "mariam", "maryam", "aya", "ayah", "fatma", "fatima", "menna", "salma", "yasmin", "yasmine",
  "nada", "reem", "habiba", "farah", "dina", "malak", "hany", "hani", "mina", "fady",
  "george", "peter", "bishoy", "kerollos", "nabil", "adel", "samir", "wael", "hazem",
  "shamy", "elshamy", "el-shamy", "masry", "elmasry", "magdy", "gamal", "ashraf", "sayed",
  "saeed", "osama", "ayman", "walid", "waleed", "islam", "eslam", "sherif", "shereen",
  "احمد", "محمد", "محمود", "مصطفي", "كريم", "عمر", "عمرو", "علي", "حسن", "حسين", "خالد", "يوسف", "طارق", "نور", "مريم", "ساره", "سارا", "فاطمه", "مني", "منه", "سلمي", "دينا", "ريم", "هنا", "ايه", "ياسمين", "عبدالرحمن", "ادهم"
]);

const BLOCKED_RULES = [
  // --- English Profanity & Slurs ---
  { term: "fuck", mode: "substring" },
  { term: "fck", mode: "whole" },
  { term: "fucker", mode: "substring" },
  { term: "fucking", mode: "substring" },
  { term: "motherfuck", mode: "substring" },
  { term: "mothafuck", mode: "substring" },
  { term: "shit", mode: "substring" },
  { term: "bitch", mode: "substring" },
  { term: "bastard", mode: "substring" },
  { term: "asshole", mode: "substring" },
  { term: "dickhead", mode: "substring" },
  { term: "cunt", mode: "substring" },
  { term: "whore", mode: "substring" },
  { term: "slut", mode: "substring" },
  { term: "pussy", mode: "substring" },
  { term: "blowjob", mode: "substring" },
  { term: "handjob", mode: "substring" },
  { term: "porn", mode: "substring" },
  { term: "porno", mode: "substring" },
  { term: "nigger", mode: "substring" },
  { term: "nigga", mode: "substring" },
  { term: "faggot", mode: "substring" },
  { term: "masturbat", mode: "substring" },

  // Short English roots (whole token only)
  { term: "ass", mode: "whole" },
  { term: "dick", mode: "whole" },
  { term: "cock", mode: "whole" },
  { term: "cum", mode: "whole" },
  { term: "tit", mode: "whole" },
  { term: "tits", mode: "whole" },
  { term: "sex", mode: "whole" },

  // --- Arabic Insults & Vulgarities (Colloquial & Standard) ---
  { term: "شرموط", mode: "substring" },
  { term: "شرموطه", mode: "substring" },
  { term: "شرمطة", mode: "substring" },
  { term: "شرمطه", mode: "substring" },
  { term: "عرص", mode: "whole" },
  { term: "متناك", mode: "substring" },
  { term: "متناكه", mode: "substring" },
  { term: "تناك", mode: "substring" },
  { term: "منيك", mode: "substring" },
  { term: "منيكه", mode: "substring" },
  { term: "قحبة", mode: "substring" },
  { term: "قحبه", mode: "substring" },
  { term: "قوحب", mode: "substring" },
  { term: "قحاب", mode: "substring" },
  { term: "ديوس", mode: "substring" },
  { term: "دياثه", mode: "substring" },
  { term: "دياثة", mode: "substring" },
  { term: "كسم", mode: "substring" },
  { term: "كسمك", mode: "substring" },
  { term: "كسامك", mode: "substring" },
  { term: "كسختك", mode: "substring" },
  { term: "سكس", mode: "substring" },
  { term: "بورن", mode: "substring" },
  { term: "لواط", mode: "substring" },
  { term: "لوطي", mode: "substring" },
  { term: "مخنث", mode: "substring" },
  { term: "ابن كلب", mode: "substring" },
  { term: "ابن الكلب", mode: "substring" },
  { term: "ابن شرموطة", mode: "substring" },
  { term: "ابن الشرموطة", mode: "substring" },
  { term: "ابن متناكة", mode: "substring" },
  { term: "ابن المتناكة", mode: "substring" },
  { term: "يلعن دين", mode: "substring" },
  { term: "يلعن رب", mode: "substring" },
  { term: "سب الدين", mode: "substring" },
  { term: "دين امك", mode: "substring" },
  { term: "دين ابوك", mode: "substring" },
  { term: "يلعن ميتين", mode: "substring" },

  // Short Arabic roots (whole token only)
  { term: "كس", mode: "whole" },
  { term: "زب", mode: "whole" },
  { term: "خول", mode: "whole" },
  { term: "نيك", mode: "whole" },
  { term: "طيز", mode: "whole" },
  { term: "فسوة", mode: "whole" },
  { term: "عرصة", mode: "whole" },

  // --- Franco-Arabic Insults & Slurs ---
  { term: "sharmout", mode: "substring" },
  { term: "sharmot", mode: "substring" },
  { term: "sharmoot", mode: "substring" },
  { term: "sharmoota", mode: "substring" },
  { term: "sharmouta", mode: "substring" },
  { term: "sharmota", mode: "substring" },
  { term: "metnak", mode: "substring" },
  { term: "mitnak", mode: "substring" },
  { term: "motnak", mode: "substring" },
  { term: "qahba", mode: "substring" },
  { term: "7mar", mode: "whole" },
  { term: "7omar", mode: "whole" },
  { term: "homar", mode: "whole" },
  { term: "hmar", mode: "whole" },
  { term: "3ars", mode: "whole" },
  { term: "3arsa", mode: "whole" },
  { term: "aars", mode: "whole" },
  { term: "5ara", mode: "whole" },
  { term: "khara", mode: "whole" },
  { term: "kosom", mode: "substring" },
  { term: "kossom", mode: "substring" },
  { term: "kosomk", mode: "substring" },
  { term: "kosmak", mode: "substring" },
  { term: "kssmk", mode: "substring" },
  { term: "ksm", mode: "whole" },
  { term: "kesemak", mode: "substring" },
  { term: "kessmak", mode: "substring" },
  { term: "kos ommak", mode: "substring" },
  { term: "kos omk", mode: "substring" },
  { term: "din omk", mode: "substring" },
  { term: "deen omk", mode: "substring" },
  { term: "teez", mode: "whole" },
  { term: "teezo", mode: "whole" },
  { term: "khol", mode: "whole" },
  { term: "5ol", mode: "whole" },
  { term: "dayous", mode: "substring" },
  { term: "dayooth", mode: "substring" },
  { term: "khawal", mode: "whole" }, { term: "5awal", mode: "whole" },
  { term: "zob", mode: "whole" }, { term: "zobr", mode: "whole" }, { term: "zobrk", mode: "whole" },
  { term: "teezak", mode: "whole" }, { term: "teezk", mode: "whole" },
  { term: "kos", mode: "whole" }, { term: "koss", mode: "whole" }
];

const HOMOGLYPHS = {
  // Cyrillic
  "\u0430": "a", "\u0441": "c", "\u0435": "e", "\u043e": "o", "\u0440": "p",
  "\u0445": "x", "\u0443": "y", "\u0456": "i", "\u0458": "j", "\u0455": "s",
  "\u0432": "b", "\u043f": "n", "\u0442": "t", "\u043c": "m", "\u043a": "k",
  "\u0438": "u", "\u0439": "u",
  // Greek
  "\u03b1": "a", "\u03b2": "b", "\u03b3": "y", "\u03b5": "e", "\u03b9": "i",
  "\u03ba": "k", "\u03bf": "o", "\u03c1": "p", "\u03c4": "t", "\u03c5": "u",
  "\u03bd": "v", "\u03c9": "w", "\u03c7": "x"
};

function baseClean(raw) {
  let s = String(raw || "").normalize("NFKC").toLowerCase();
  // Strip zero-width & non-printing characters
  s = s.replace(/\p{Default_Ignorable_Code_Point}/gu, "");
  // Strip Arabic harakat (tashkeel)
  s = s.replace(/[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/g, "");
  // Strip Tatweel / Kashida
  s = s.replace(/\u0640/g, "");
  // Normalize Arabic letter variants
  s = s.replace(/[أإآٱٲٳ]/g, "ا");
  s = s.replace(/[ىئ]/g, "ي");
  s = s.replace(/ة/g, "ه");
  s = s.replace(/ؤ/g, "و");
  // Convert Arabic-Indic & Eastern digits
  s = s.replace(/[٠۰]/g, "0")
       .replace(/[١۱]/g, "1")
       .replace(/[٢۲]/g, "2")
       .replace(/[٣۳]/g, "3")
       .replace(/[٤۴]/g, "4")
       .replace(/[٥۵]/g, "5")
       .replace(/[٦۶]/g, "6")
       .replace(/[٧۷]/g, "7")
       .replace(/[٨۸]/g, "8")
       .replace(/[٩۹]/g, "9");
  // Homoglyph conversion
  let replaced = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    replaced += HOMOGLYPHS[ch] || ch;
  }
  return replaced;
}

function generateReadingVariants(clean) {
  // Reading 1: Leet (4 mapped to u, etc.)
  let leet1 = clean
    .replace(/0/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "u")
    .replace(/5/g, "s")
    .replace(/6/g, "g")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/9/g, "g")
    .replace(/@/g, "a")
    .replace(/\$/g, "s");

  // Reading 2: Leet (4 mapped to a, etc.)
  let leet2 = clean
    .replace(/0/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/6/g, "g")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/9/g, "g")
    .replace(/@/g, "a")
    .replace(/\$/g, "s");

  // Reading 3: Franco
  let franco = clean
    .replace(/2/g, "a")
    .replace(/3'/g, "gh")
    .replace(/3/g, "ع")
    .replace(/5/g, "kh")
    .replace(/7/g, "h")
    .replace(/8/g, "gh")
    .replace(/9/g, "q")
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/@/g, "a");

  // Reading 4: Franco to Arabic characters
  let francoArabic = clean
    .replace(/2/g, "ا")
    .replace(/3'/g, "غ")
    .replace(/3/g, "ع")
    .replace(/5/g, "خ")
    .replace(/7/g, "ح")
    .replace(/8/g, "غ")
    .replace(/9/g, "ق")
    .replace(/0/g, "و")
    .replace(/1/g, "ي");

  return [clean, leet1, leet2, franco, francoArabic];
}

function collapseRepeated(str) {
  return str.replace(/(.)\1+/gu, "$1");
}

function extractTokens(str) {
  return str.split(/[\s\-_\.\*\+\/,:;~\(\)\[\]\{\}|<>!?#%^&='"]+/).filter(Boolean);
}

function checkModeration(rawUsername) {
  const clean = baseClean(rawUsername);
  if (!clean.trim()) return { ok: true, username: rawUsername };

  const rawTokens = extractTokens(clean);
  const joinedClean = clean.replace(/[^\p{L}\p{N}]/gu, "");

  if (ALLOWLIST.has(clean) || ALLOWLIST.has(joinedClean)) {
    return { ok: true, username: rawUsername };
  }

  // Interpret numeric suffixes before leet conversion (e.g. an insult + class year).
  // Set avoids repeating the same scan for ordinary alphabetic names.
  const withoutCounters=rawTokens.map(t=>t.replace(/[0-9]+$/g,"")).join(" ");
  const readings = new Set([...generateReadingVariants(clean),...generateReadingVariants(withoutCounters)]);

  for (const reading of readings) {
    const tokens = extractTokens(reading);
    const joined = reading.replace(/[^\p{L}\p{N}]/gu, "");
    const collapsedJoined = collapseRepeated(joined);
    const collapsedTokens = tokens.map(collapseRepeated);
    const spacedReading = reading.replace(/[\-_\.\*\+\/,:;~\(\)\[\]\{\}|<>!?#%^&='"]+/g, " ");

    for (const rule of BLOCKED_RULES) {
      const term = rule.term;
      const termStripped = term.replace(/\s+/g, "");
      const collapsedTerm = collapseRepeated(termStripped);

      if (rule.mode === "whole") {
        if (tokens.includes(term) || collapsedTokens.includes(collapsedTerm) ||
            tokens.includes(termStripped) ||
            [...tokens,joined].some(token=>(token.endsWith(termStripped)&&ALLOWLIST.has(token.slice(0,-termStripped.length)))||(token.startsWith(termStripped)&&ALLOWLIST.has(token.slice(termStripped.length)))) ||
            joined === termStripped || collapsedJoined === collapsedTerm) {
          // A legitimate name elsewhere must not exempt a matched offensive token.
          return { ok: false, error: "Please choose another username." };
        }
      } else {
        // Substring match
        if (joined.includes(termStripped) || collapsedJoined.includes(collapsedTerm) ||
            spacedReading.includes(term)) {
          let allowlisted = false;
          for (const allowed of ALLOWLIST) {
            if (joined.includes(allowed) && allowed.includes(termStripped)) {
              allowlisted = true;
              break;
            }
          }
          if (!allowlisted) {
            return { ok: false, error: "Please choose another username." };
          }
        }
      }
    }
  }

  return { ok: true, username: rawUsername };
}

module.exports = {
  checkModeration,
  baseClean,
  ALLOWLIST,
  BLOCKED_RULES
};
