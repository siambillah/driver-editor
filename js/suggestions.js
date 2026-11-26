// প্রতিটা ল্যাঙ্গুয়েজের জন্য আলাদা Keyword এবং Snippet ডিকশনারি
export const LANGUAGE_DICTIONARIES = {
  python: [
    "def ", "class ", "import ", "from ", "return ", "async def ", "await ",
    "if __name__ == '__main__':", "try:", "except Exception as e:", "finally:",
    "print()", "len()", "range()", "enumerate()", "zip()", "isinstance()",
    "json.loads()", "json.dumps()", "requests.get()", "requests.post()",
    "with open('file.txt', 'r', encoding='utf-8') as f:", "datetime.now()"
  ],
  htmlmixed: [
    "<!DOCTYPE html>", "<html lang=\"en\">", "<head>", "<body>", "<meta charset=\"UTF-8\" />",
    "<div class=\"\">", "<span class=\"\">", "<section>", "<header>", "<footer>",
    "<a href=\"\">", "<img src=\"\" alt=\"\" />", "<button onclick=\"\">",
    "<input type=\"text\" placeholder=\"\" />", "<script src=\"\"></script>", "<link rel=\"stylesheet\" href=\"\" />"
  ],
  javascript: [
    "const ", "let ", "function ", "async function ", "await ", "return ",
    "document.getElementById('')", "document.querySelector('')", "addEventListener('click', () => {})",
    "fetch('').then(res => res.json())", "JSON.parse()", "JSON.stringify()",
    "console.log()", "localStorage.getItem('')", "localStorage.setItem('', '')"
  ],
  css: [
    "display: flex;", "justify-content: center;", "align-items: center;",
    "display: grid;", "grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));",
    "background-color: ", "border-radius: 6px;", "box-shadow: 0 4px 12px rgba(0,0,0,0.1);",
    "@media (max-width: 768px) {}"
  ],
  sql: [
    "SELECT * FROM ", "WHERE ", "INSERT INTO ", "VALUES ()", "UPDATE ", "SET ",
    "DELETE FROM ", "ORDER BY ", "GROUP BY ", "LEFT JOIN ", "CREATE TABLE "
  ]
};

// কাস্টম Snippets (শর্টকাট শব্দ লিখে Suggest চাপলে পুরো কোড ব্লক বসবে)
export const CODE_SNIPPETS = {
  html5: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Document</title>\n</head>\n<body>\n  <h1>Hello World</h1>\n</body>\n</html>`,
  pyreq: `import requests\n\nurl = "https://api.example.com/data"\nresponse = requests.get(url, timeout=10)\nprint(response.status_code, response.json())`,
  pymain: `def main():\n    print("Running main...")\n\nif __name__ == "__main__":\n    main()`
};

export function registerCustomHints(CodeMirror) {
  CodeMirror.registerHelper("hint", "smartHint", function (editor) {
    const cursor = editor.getCursor();
    const token = editor.getTokenAt(cursor);
    const mode = editor.getOption("mode");

    let start = token.start;
    let end = cursor.ch;
    let word = token.string.slice(0, end - start);

    if (!/^[\w<$-]+$/.test(word)) {
      word = "";
      start = end;
    }

    // ১. কাস্টম ডিকশনারি থেকে সাজেশন নেওয়া
    const dict = LANGUAGE_DICTIONARIES[mode] || [];
    const snippetKeys = Object.keys(CODE_SNIPPETS).map(k => ({
      text: CODE_SNIPPETS[k],
      displayText: `⚡ Snippet: ${k}`
    }));

    // ২. ফাইলের ভেতরে আগে লেখা শব্দগুলো সংগ্রহ করা (anyword)
    const anywordResult = CodeMirror.hint.anyword(editor) || { list: [] };

    // ৩. HTML/CSS/JS হলে বিল্ট-ইন হিন্টও যুক্ত করা
    let builtInList = [];
    if (mode === "htmlmixed" && CodeMirror.hint.html) {
      builtInList = (CodeMirror.hint.html(editor)?.list || []);
    } else if (mode === "css" && CodeMirror.hint.css) {
      builtInList = (CodeMirror.hint.css(editor)?.list || []);
    } else if (mode === "javascript" && CodeMirror.hint.javascript) {
      builtInList = (CodeMirror.hint.javascript(editor)?.list || []);
    }

    const combined = new Map();

    // Snippets match
    snippetKeys.forEach(s => {
      if (!word || s.displayText.toLowerCase().includes(word.toLowerCase())) {
        combined.set(s.displayText, s);
      }
    });

    // Dictionary & built-in match
    [...dict, ...builtInList, ...anywordResult.list].forEach(item => {
      const text = typeof item === "string" ? item : item.text;
      if (text && text !== word && text.toLowerCase().startsWith(word.toLowerCase())) {
        if (!combined.has(text)) {
          combined.set(text, item);
        }
      }
    });

    return {
      list: Array.from(combined.values()),
      from: CodeMirror.Pos(cursor.line, start),
      to: CodeMirror.Pos(cursor.line, end)
    };
  });
}

export function setupAutoComplete(editor) {
  // টাইপ করার সাথে সাথে অটোমেটিক সাজেশন পপআপ দেখানো
  editor.on("inputRead", (cm, change) => {
    if (change.origin !== "+input") return;
    const ch = change.text[0];
    if (/[a-zA-Z_<]/.test(ch) && !cm.state.completionActive) {
      cm.showHint({ hint: CodeMirror.hint.smartHint, completeSingle: false });
    }
  });
}
