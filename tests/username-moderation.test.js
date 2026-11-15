/**
 * Username Moderation & Obfuscation Resistance Test Suite
 * (`tests/username-moderation.test.js`)
 *
 * Verifies:
 * - >= 150 offensive & obfuscated test cases are rejected.
 * - >= 60 innocent Egyptian and English names/words are accepted (zero false positives).
 * - Server validateUsernameServer() integration.
 * - Error message generic shape (no echo of matched keyword).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const worker = require("../backend/worker");
const moderation = require("../backend/username-moderation");

// ---------------------------------------------------------------------------
// 1. Offense & Obfuscation Test Cases (236 cases across all categories)
// ---------------------------------------------------------------------------
const BLOCKED_CASES = [
  // 1. Plain English Profanity & Slurs
  "fuck", "fucker", "fucking", "motherfucker", "shit", "bitch", "bastard", "asshole", "dickhead",
  "cunt", "whore", "slut", "pussy", "blowjob", "handjob", "porn", "porno", "nigger", "nigga",
  "faggot", "masturbate",

  // 2. English Leetspeak
  "f_u_c_k", "fuck123", "sh1t", "b1tch", "b!tch", "4sshole", "pu$$y", "wh0re", "d1ckhe4d", "c0ck",
  "f*ck", "f.u.c.k", "s-h-i-t", "b_i_t_c_h", "a$$hole", "p_u_s_s_y", "f.u.c.k.e.r", "m0therfucker",
  "mothafucka", "sh!tt", "f4ck", "sh!t_head", "b1tch_boy", "a55hole", "c0ck_head",

  // 3. Repeated Characters English
  "fuuuuck", "shiiit", "biitch", "assshole", "puuuussy", "whhoore", "cuuunt", "ffuucckk", "sshh11tt",
  "fuuuuckeeer", "biiiitchy", "asssssholeee",

  // 4. English Separators, Spaces, Zero-Width
  "f u c k", "s h i t", "b i t c h", "p u s s y", "f\u200Bu\u200Cc\u200Dk", "s\u200Bh\u200Ci\u200Dt",
  "b\u200Bi\u200Ct\u200Dch", "a_s_s_h_o_l_e", "d-i-c-k-h-e-a-d", "f*u*c*k", "f.u.c.k", "f+u+c+k",
  "f/u/c/k", "f#u#c#k", "f u c k e r", "s  h  i  t",

  // 5. English Homoglyphs (Cyrillic & Greek)
  "fисk", "shіt", "bіtch", "рussy", "аsshole", "whоre", "сосk", "fuсk", "dісk", "аss", "сunt",

  // 6. Plain Arabic
  "شرموط", "شرموطة", "عرص", "خول", "متناك", "متناكة", "تناك", "منيك", "منيكة", "قحبة", "قحبه",
  "قحاب", "ديوس", "دياثة", "كس", "زب", "طيز", "نيك", "سكس", "بورن", "لواط", "لوطي", "مخنث",
  "ابن كلب", "ابن الكلب", "ابن شرموطة", "ابن الشرموطة", "ابن متناكة", "ابن المتناكة",
  "يلعن دينك", "يلعن ربك", "سب الدين", "كسمك", "كس امك", "كس اختك", "دين امك", "دين ابوك", "يلعن ميتينك",

  // 7. Arabic Harakat & Tatweel
  "شَـرْمُـوطَـة", "عَـرَصْ", "خَـوْل", "مُـتَـنَـاك", "قَـحْـبَـة", "كَـسْـمَـك", "زُبّ", "كُـسّ", "طِـيـز", "نِـيـك",
  "شــــرمــــوط", "عـــــرص", "خــــول", "مــــتـــنـــاك", "كــــســــمــــك", "قــــحــــبــــة",

  // 8. Arabic Letter Variants & Alef
  "إبن كلب", "إبن الشرموطة", "متنآك", "كسمككك", "كس أمك", "كس إختك", "يلعن دين أُمك",

  // 9. Arabic Separators, Spaces, Zero-Width
  "ش ر م و ط", "ع ر ص", "خ و ل", "م ت ن ا ك", "ق ح ب ه", "ك س م ك", "ش_ر_م_و_ط", "ع_ر_ص", "خ_و_ل",
  "م_ت_ن_ا_ك", "ق_ح_ب_ة", "ك-س-م-ك", "ش.ر.م.و.ط", "ش*ر*م*و*ط", "ع\u200Bر\u200Bص", "خ\u200Bو\u200Bل", "م\u200Bت\u200Bن\u200Bا\u200Bك",

  // 10. Arabic Repeated Letters
  "ششررممووططة", "ععررصص", "خخوولل", "ممتتننااكك", "قوححببهه", "ككككككسمك", "زببببب", "ككككككس", "طططيييز",

  // 11. Franco-Arabic Plain & Variants
  "3ars", "3arsa", "aars", "5ara", "khara", "7mar", "7omar", "homar", "hmar", "kosom", "kosomk",
  "kossom", "kosmak", "kssmk", "ksm", "kesemak", "kessmak", "kos ommak", "kos omk", "din omk", "deen omk",
  "sharmout", "sharmouta", "sharmoot", "sharmoota", "sharmot", "sharmota", "metnak", "mitnak",
  "motnak", "qahba", "teez", "teezo", "khol", "5ol", "dayous", "dayooth", "ya 3ars",
  "ebn el sharmouta", "ebn el metnaka",

  // 12. Franco Numerals & Separators & Leet
  "3_a_r_s", "5_a_r_a", "7_o_m_a_r", "k_o_s_o_m_k", "sh_a_r_m_o_u_t", "m_e_t_n_a_k", "333aaarrrsss",
  "555ara", "777omar", "k0s0m", "k0s0mk", "sh4rm0ut", "m3tn4k", "3*a*r*s", "5.a.r.a", "7-o-m-a-r",
  "3 a r s", "5 a r a", "7 o m a r", "k o s o m k", "sh a r m o u t", "sh@rmouta", "k0$$0m", "5_o_l"
];

// ---------------------------------------------------------------------------
// 2. False-Positive Innocence Test Cases (93 cases)
// ---------------------------------------------------------------------------
const INNOCENT_CASES = [
  // English words with Scunthorpe substrings (ass, cock, dick, cum, tit, butt)
  "classic_gamer", "compass_app", "cassette_tape", "peacock_feather", "hitchcock_fan", "dickens_reader",
  "document_parser", "button_clicker", "butter_toast", "therapist_dr", "basement_lab", "ambassador_club",
  "attitude_star", "entity_system", "grass_hopper", "glass_craft", "master_class", "assembly_coder",
  "associate_prof", "assets_manager", "passport_holder",

  // Egyptian common names
  "ahmed", "ahmed_2004", "ahmed_ali", "mohamed", "mohamed_2025", "mahmoud_eng", "mostafa_99",
  "mustafa_dr", "tarek_it", "tariq_dev", "kareem_alex", "karim_cairo", "youssef_2000", "omar_farouk",
  "amr_diab", "ali_hassan", "aly_student", "hassan_cs", "hussein_lab", "hossam_chem", "ibrahim_phys",
  "khaled_99", "zeyad_10", "ziad_math", "nour_2026", "nourhan_art", "sarah_bio", "mariam_f",
  "aya_cs", "fatma_eng", "menna_law", "salma_pharm", "yasmin_dent", "nada_nurse", "reem_design",
  "habiba_it", "farah_sci", "dina_coder", "malak_dev", "hany_ramzy", "mina_makram", "fady_nabil",
  "peter_safwat", "george_morcos", "bishoy_adel", "kerollos_magdy", "adel_emam", "samir_ghanem",
  "wael_gomaa", "hazem_emam",

  // Egyptian family names & words with potentially sensitive roots (kholy, kassab, mechanic, etc.)
  "elkholy", "kholy", "ahmed_elkholy", "kassab", "mohamed_kassab", "kassar", "el-shamy", "shamy",
  "masry", "elmasry", "inikas_light", "nicholas_cage", "nicole_kidman", "technique_master",
  "mechanic_car", "sharm_el_sheikh", "mounir_fan", "monir_music", "zubaida_queen",
  "student_101", "eng_ziad_99", "dr_tarek_2024"
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test("Section 6A — Moderation engine rejects all 236 offensive and obfuscated test cases", () => {
  assert.ok(BLOCKED_CASES.length >= 150, "Must have at least 150 offensive cases");
  let rejectedCount = 0;
  const missed = [];

  for (const tc of BLOCKED_CASES) {
    const res = moderation.checkModeration(tc);
    if (!res.ok) {
      rejectedCount++;
      // Verify error message shape does NOT echo back the matched keyword
      assert.equal(res.error, "Please choose another username.");
    } else {
      missed.push(tc);
    }
  }

  assert.deepEqual(missed, [], `All blocked cases must be caught, but missed: ${missed.join(", ")}`);
  assert.equal(rejectedCount, BLOCKED_CASES.length);
});

test("Section 6B — Moderation engine accepts all 93 innocent Egyptian and English usernames (0 false positives)", () => {
  assert.ok(INNOCENT_CASES.length >= 60, "Must have at least 60 false-positive test cases");
  let acceptedCount = 0;
  const falsePositives = [];

  for (const tc of INNOCENT_CASES) {
    const res = moderation.checkModeration(tc);
    if (res.ok) {
      acceptedCount++;
    } else {
      falsePositives.push(tc);
    }
  }

  assert.deepEqual(falsePositives, [], `Zero false positives allowed, but rejected: ${falsePositives.join(", ")}`);
  assert.equal(acceptedCount, INNOCENT_CASES.length);
});

test("Section 6C — Server validateUsernameServer() integration and generic error response", () => {
  // Test server-level rejection of plain offensive word
  const res1 = worker.validateUsernameServer("fuck_123");
  assert.equal(res1.ok, false);
  assert.equal(res1.error, "Please choose another username.");

  // Test server-level rejection of Franco offensive word
  const res2 = worker.validateUsernameServer("ya_3ars");
  assert.equal(res2.ok, false);
  assert.equal(res2.error, "Please choose another username.");

  // Test server-level rejection of Arabic offensive word with harakat
  const res3 = worker.validateUsernameServer("شَـرْمُـوطَـة");
  assert.equal(res3.ok, false);
  assert.equal(res3.error, "Please choose another username.");

  // Test server-level acceptance of normal Egyptian student names
  const ok1 = worker.validateUsernameServer("ahmed_2004");
  assert.equal(ok1.ok, true);
  assert.equal(ok1.username, "ahmed_2004");

  const ok2 = worker.validateUsernameServer("tarek_elkholy");
  assert.equal(ok2.ok, true);
  assert.equal(ok2.username, "tarek_elkholy");

  const ok3 = worker.validateUsernameServer("nour_cs_2026");
  assert.equal(ok3.ok, true);
  assert.equal(ok3.username, "nour_cs_2026");

  // Reserved names check
  const resReserved = worker.validateUsernameServer("admin");
  assert.equal(resReserved.ok, false);
  assert.equal(resReserved.error, "This username is reserved.");
});
