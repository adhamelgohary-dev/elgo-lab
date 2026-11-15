/* Question-scoped teaching notes. No subject-wide rule is substituted for an answer.
   Pure functions are shared by the browser, content refinement and tests. */
(function (root) {
  "use strict";
  function clean(value) {
    return String(value || "").replace(/^\s*(?:FIXED|TODO|TBD)\s*[:\-]?\s*/i, "").trim();
  }
  function generic(value) {
    return /يطابق القاعدة العلمية أو النتيجة الحسابية|دون تعارض مع المعطيات|إما تخلط بين مصطلحات قريبة|هو الإجابة الصحيحة لأنه يطابق|is correct because it directly satisfies|الخيارات الخاطئة بتمثل حالات شائعة من الخلط/.test(value || "");
  }
  function curated(question) {
    if (!question) return null;
    const stem = String(question.question || question.text || "");
    const options = question.options || [];
    const correct = options.find((o) => o.id === question.correctOptionId);
    const answer = correct ? String(correct.text || "") : "";
    const note = (explanation, rule, mistake) => ({ explanation, rule: rule || "", mistake: mistake || "" });
    // Never infer polarity or the answer of a negative / True-False question.
    if (/\b(?:except|incorrect|false|not true|not a|not an)\b/i.test(stem) || /^(?:true|false)$/i.test(answer.trim())) return null;
    if (/\bRMSE\b/i.test(answer) && /\bMAE\b/i.test(answer) && /vectors?|distance|measure|error/i.test(stem)) return note(
      "<strong>RMSE — Root Mean Squared Error</strong><br>متوسط الخطأ التربيعي بعد أخذ الجذر: بنربّع كل فرق بين القيمة الحقيقية والتوقع، ناخد متوسط المربعات، وبعدين الجذر. التربيع بيخلّي الغلط الكبير مؤثر أكتر.<br><br><strong>MAE — Mean Absolute Error</strong><br>متوسط الخطأ المطلق: بناخد حجم كل فرق من غير إشارته، وبعدين المتوسط. مفيش تربيع؛ فالأخطاء بتدخل بحجمها نفسه.<br><br><strong>مثال:</strong> لو الفروق 1 و3، يبقى MAE = 2 وRMSE = √5 ≈ 2.24.<br><br>السؤال يقصد إن الاتنين بيقيسوا اختلاف المتجهات. بدقة: MAE = L1/n وRMSE = L2/√n؛ نسخ مُطبّعة من مسافات Manhattan وEuclidean، مش نفس المسافة الخام. n هو عدد القيم، وy القيمة الحقيقية، وŷ التوقع.",
      "MAE = (1/n) Σ |yᵢ − ŷᵢ|; RMSE = √[(1/n) Σ (yᵢ − ŷᵢ)<sup>2</sup>]",
      "افتكر: Absolute يعني قيمة مطلقة، وSquared يعني تربيع. ما تبدّلش بينهم، وما تعتبرش RMSE مساويًا لـL2 من غير عامل التطبيع."
    );
    if (/summary.*numerical|descriptive statistics/i.test(stem) && /describe\(\)/i.test(answer)) {
      return note("السؤال طالب ملخص إحصائي للأعمدة العددية. دالة describe() بتطلع count وmean وstd وأصغر وأكبر قيمة والـquartiles في جدول واحد.", "df.describe()", "shape بترجع عدد الصفوف والأعمدة، وinfo() بتعرض أنواع البيانات والقيم غير الفارغة؛ ولا واحدة بديل للملخص الإحصائي.");
    }
    if (/one.?hot|categorical.*(?:binary|vector)/i.test(stem) && /one.?hot/i.test(answer)) {
      return note("كل فئة بتاخد عمود مستقل: مكان الفئة الموجودة يتحط 1 والباقي 0. كده الموديل مش هيفهم إن فيه ترتيب رقمي بين فئات زي الألوان.", "One-hot encoding: one binary feature per category.", "Label encoding بأرقام 0 و1 و2 ممكن يوحي بترتيب بين الفئات، حسب الموديل المستخدم.");
    }
    if (/scales|feature scaling|standardiz|normaliz/i.test(stem) && /different|standardiz|normaliz|feature scaling/i.test(answer)) return note(
      "لما الأعمدة تبقى بمقاييس مختلفة، العمود ذو الأرقام الكبيرة ممكن يسيطر على حساب المسافات أو على خطوات التعلم. بنستخدم Scaling علشان المقارنة تبقى مناسبة للخوارزمية، ونتعلم معاملات التحويل من Training set فقط.",
      "Standardization: z = (x − μ_train) / σ_train; Min-max: (x − min_train) / (max_train − min_train).",
      "Min-max بيخلي بيانات التدريب في [0, 1] في الحالة المعتادة، لكن قيمة جديدة خارج نطاق التدريب ممكن تخرج بره الفترة."
    );
    if (/overfit|underfit|generaliz|training|model|decision tree|polynomial/i.test(stem) && /^over.?fitting$/i.test(answer.trim())) return note(
      "Overfitting معناه إن الموديل التقط تفاصيل وNoise من بيانات التدريب، فبيعمل عليها نتيجة قوية لكن أداؤه بيضعف على بيانات جديدة. راقب الفرق بين Training وValidation بدل ما تحكم من نتيجة التدريب لوحدها.",
      "Fit on training data; choose complexity with validation data; evaluate once on the held-out test set."
    );
    if (/underfit|training|model|bias|complexity/i.test(stem) && /^under.?fitting$/i.test(answer.trim())) return note(
      "الموديل هنا أبسط من اللازم أو ما اتدرّبش كفاية، فمش قادر يلتقط النمط الأساسي. غالبًا هتلاقي أداء ضعيف على Training وValidation مع بعض؛ راجع السعة والـfeatures والتدريب.", "Underfitting is associated with high bias."
    );
    if (/\b(?:learning|labels?|training|examples?|categories|classes|prediction)\b/i.test(stem) && /^(?:supervised(?: learning)?|classification|regression|clustering|unsupervised(?: learning)?)$/i.test(answer.trim())) {
      const a = answer.trim().toLowerCase();
      if (a.startsWith("supervised")) return note("في Supervised Learning أمثلة التدريب معاها الإجابة المطلوبة Label. الموديل بيتعلم العلاقة بين المدخلات والإجابة، وبعدها نجربه على بيانات ما شافهاش.");
      if (a === "classification") return note("المطلوب اختيار فئة من فئات منفصلة، زي Spam أو Not spam؛ ده Classification. حتى لو كتبنا الفئات بأرقام، الأرقام هنا أسماء للفئات مش كمية مستمرة بنقيسها.");
      if (a === "regression") return note("المطلوب توقع قيمة عددية مستمرة، زي سعر أو درجة حرارة، وده Regression. فرّق بينها وبين رقم بيمثل اسم فئة؛ اسم الفئة يفضل Classification.");
      if (a === "clustering") return note("Clustering بتجمع الأمثلة المتشابهة من غير Labels جاهزة للمجموعات. شكل النتيجة بيعتمد على تعريف التشابه والخوارزمية؛ رقم المجموعة مش فئة معروفة مسبقًا.");
      return note("في Unsupervised Learning مش بنعطي الموديل Labels للإجابات المطلوبة؛ بنبحث عن بنية أو علاقات داخل البيانات، زي تجميع العناصر المتشابهة.");
    }
    if (/\b(?:data|transmission|communication|direction|mode)\b/i.test(stem)) {
      if (/^full[ -]?duplex$/i.test(answer.trim())) return note("Full-duplex بيسمح بالإرسال والاستقبال في نفس الوقت. وجود اتجاهين لوحده مش كفاية؛ لو بالتبادل يبقى Half-duplex.");
      if (/^half[ -]?duplex$/i.test(answer.trim())) return note("الاتصال شغال في الاتجاهين، لكن كل طرف يستنى دوره؛ زي Walkie-talkie. الفرق عن Full-duplex إن الطرفين مش بيتكلموا في نفس اللحظة.");
      if (/^simplex$/i.test(answer.trim())) return note("Simplex يعني البيانات ماشية في اتجاه واحد فقط داخل وصلة الاتصال المقصودة. ده مختلف عن Half-duplex اللي يسمح بالرجوع لكن بالتبادل.");
    }
    if (/end.to.end|process.to.process|port numbers?/i.test(stem) && /^(?:transport(?: layer)?|TCP|UDP)$/i.test(answer.trim())) return note(
      "Transport بتوصل البيانات بين التطبيقات على الطرفين باستخدام Port numbers. IP وRouting تابعين لطبقة Network؛ أما الضمانات زي إعادة الإرسال فتعتمد على البروتوكول، ومش موجودة في UDP.",
      "TCP: reliable ordered byte stream. UDP: datagrams without delivery or ordering guarantees."
    );
    if (/\bsupport\b/i.test(stem) && /frequency|transaction|count|probability/i.test(answer)) return note(
      "Support بتقيس قد إيه مجموعة العناصر ظهرت وسط كل الـtransactions. لو القاعدة X → Y، بنعد العمليات اللي فيها X وY مع بعض، ونقسم على إجمالي العمليات.",
      "Support(X → Y) = count(X ∪ Y) / N."
    );
    if (/\bconfidence\b/i.test(stem) && /support|conditional|probability|transaction/i.test(answer)) return note(
      "Confidence بتسأل: من العمليات اللي ظهر فيها X، كام واحدة ظهر فيها Y كمان؟ المقام هنا عمليات X فقط، مش إجمالي البيانات.",
      "Confidence(X → Y) = support(X ∪ Y) / support(X), when support(X) > 0."
    );
    if (/\bprecision\b/i.test(stem) && /TP\s*\/\s*\(?\s*TP\s*\+\s*FP/i.test(answer)) {
      return note("Precision بتسأل: من كل الحالات اللي الموديل قال عليها Positive، كام واحدة كانت Positive فعلًا؟ عشان كده المقام بيجمع الصح TP مع الإنذارات الغلط FP.", "Precision = TP / (TP + FP)", "Recall مقامها TP + FN، لأنها بتقيس كام حالة موجبة حقيقية قدرنا نكتشفها.");
    }
    if (/\brecall\b|sensitivity/i.test(stem) && /TP\s*\/\s*\(?\s*TP\s*\+\s*FN/i.test(answer)) {
      return note("Recall بتقيس الحالات الموجبة الحقيقية اللي قدرنا نلقطها. إجمالي الحالات الموجبة الحقيقية هو TP + FN، ومنها اكتشفنا TP.", "Recall = TP / (TP + FN)", "FP إنذار غلط، لكن FN حالة موجبة فاتتنا. هنا المهم الحالات اللي فاتتنا.");
    }
    if (/\b(?:2['’]?s|two['’]?s|2nd) complement/i.test(stem)) {
      const bits = stem.match(/\b[01]{4,16}\b/);
      if (bits && !/decimal|represents|represented|value of/i.test(stem)) {
        const original = bits[0], width = original.length;
        const inverted = original.replace(/[01]/g, (b) => b === "0" ? "1" : "0");
        const result = ((parseInt(inverted, 2) + 1) % Math.pow(2, width)).toString(2).padStart(width, "0");
        if (answer.replace(/[^01]/g, "") === result) return note(
          `اقلب كل بت مع الحفاظ على ${width} بت: ${original} هتبقى ${inverted}. زوّد 1، فالنتيجة ${result}. لو حصل carry بره عدد البتات ده، تجاهله.`,
          "Two’s complement = bitwise inversion + 1 (fixed bit width).",
          "القلب لوحده بيدي 1’s complement؛ خطوة إضافة 1 هي اللي بتكمل الحل."
        );
      }
    }
    if (/\bnyquist\b/i.test(stem) && /2\s*(?:\*|×|B|b|bandwidth|H)/.test(answer)) return note(
      "في قناة مثالية من غير Noise، معدل نقل البيانات بيتحدد بعرض النطاق وعدد مستويات الإشارة. استخدم عدد المستويات L في اللوغاريتم للأساس 2.",
      "Maximum bit rate = 2 × bandwidth × log2(L).", "ما تستخدمش معادلة Shannon هنا؛ دي بتدخل نسبة Signal-to-Noise في الحساب."
    );
    if (/\bshannon\b/i.test(stem) && /log|bandwidth|S\/N/i.test(answer)) return note(
      "سعة القناة مع وجود Noise بتعتمد على Bandwidth ونسبة Signal-to-Noise. لو SNR مكتوبة بـdB، حولها لنسبة عادية قبل التعويض.",
      "C = B × log2(1 + S/N); S/N = 10^(SNR_dB / 10)."
    );
    if (/\bbisection\b/i.test(stem) && /midpoint|\(?a\s*\+\s*b\)?\s*\/\s*2|\(?b\s*\+\s*a\)?\s*\/\s*2/i.test(answer)) return note(
      "بنقسم الفترة نصين عند المنتصف، ونحتفظ بالنص اللي طرفيه عندهم قيم للدالة بإشارتين مختلفتين. لازم الدالة تكون continuous على الفترة علشان ضمان وجود الجذر.",
      "c = (a + b) / 2; keep a bracket with f(a) × f(b) < 0."
    );
    if (/\bnewton/i.test(stem) && /f\s*\(?x|derivative|tangent/i.test(answer)) return note(
      "Newton-Raphson بتستخدم ميل المماس علشان تحدد التقريب اللي بعده. نقطة البداية مهمة، ولو المشتقة صفر أو قريبة جدًا من الصفر فالخطوة ممكن تفشل؛ التقارب مش مضمون من أي بداية.",
      "x_(n+1) = x_n − f(x_n) / f′(x_n)."
    );
    return null;
  }
  function present(question, resolved, opts) {
    const specific = curated(question);
    const r = resolved || {};
    const distinct = (a, b) => clean(a).replace(/[\s.,،؛]+/g, "") !== clean(b).replace(/[\s.,،؛]+/g, "");
    const main = specific ? specific.explanation : [r.academicExplanation, r.correctReasoning].map(clean).find((t) => t && !generic(t)) || "";
    // Legacy rules were injected by subject (e.g. generalization below a Pandas question).
    // Only a question-scoped curated rule is trusted; preserve originals in the source backup.
    let mistake = specific ? specific.mistake : clean(r.wrongAnswerClarification);
    if (!opts || !opts.selectedOptId || opts.isRight || generic(mistake) || !distinct(mistake, main)) mistake = "";
    return { explanation: main, rule: specific ? specific.rule : "", mistake };
  }
  const api = { clean, generic, curated, present };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ElgoExplanations = api;
  root.BankQuestionCore = root.BankQuestionCore || {};
  root.BankQuestionCore.ExplanationPresenter = api;
})(typeof window !== "undefined" ? window : globalThis);
