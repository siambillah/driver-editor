const CUSTOM_SNIPPETS_KEY = 'npp_custom_snippets_v1';

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
    "console.log()", "localStorage.getItem('')", "localStorage.setItem('', '')",
    "try {\n  \n} catch (err) {\n  console.error(err);\n}"
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
  ],
  shell: [
    "#!/usr/bin/env bash", "set -euo pipefail", "echo ", "export ", "chmod +x ",
    "if [ -f \"\" ]; then\n  \nfi", "for f in *; do\n  echo \"$f\"\ndone"
  ],
  'text/x-c++src': [
    "#include <iostream>", "#include <vector>", "#include <string>",
    "using namespace std;", "int main() {\n    return 0;\n}", "std::cout <<  << std::endl;"
  ],
  'text/x-java': [
    "public class Main {\n    public static void main(String[] args) {\n        System.out.println(\"Hello\");\n    }\n}",
    "System.out.println();", "public static ", "private final "
  ],
  'application/x-httpd-php': [
    "<?php\n\n?>", "echo ", "function ", "foreach ($items as $item) {\n    \n}", "json_encode()"
  ],
  'text/x-go': [
    "package main", "import \"fmt\"", "func main() {\n\tfmt.Println(\"Hello\")\n}",
    "if err != nil {\n\treturn err\n}"
  ],
  'text/x-rustsrc': [
    "fn main() {\n    println!(\"Hello, world!\");\n}", "let mut ", "match ", "impl ", "pub struct "
  ]
};

// বিল্ট-ইন Snippets
export const CODE_SNIPPETS = {
  html5: {
    lang: 'htmlmixed',
    code: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Document</title>\n</head>\n<body>\n  <h1>Hello World</h1>\n</body>\n</html>`
  },
  pyreq: {
    lang: 'python',
    code: `import requests\n\nurl = "https://api.example.com/data"\nresponse = requests.get(url, timeout=10)\nprint(response.status_code, response.json())`
  },
  pymain: {
    lang: 'python',
    code: `def main():\n    print("Running main...")\n\nif __name__ == "__main__":\n    main()`
  },
  jsfetch: {
    lang: 'javascript',
    code: `async function fetchData(url) {\n  const res = await fetch(url);\n  if (!res.ok) throw new Error(\`HTTP \${res.status}\`);\n  return await res.json();\n}`
  },
  cppmain: {
    lang: 'text/x-c++src',
    code: `#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello World!" << endl;\n    return 0;\n}`
  }
};

export function getCustomSnippets() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_SNIPPETS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveCustomSnippetEntry(key, lang, code) {
  const all = getCustomSnippets();
  all[key] = { lang: lang || 'all', code };
  localStorage.setItem(CUSTOM_SNIPPETS_KEY, JSON.stringify(all));
}

export function deleteCustomSnippetEntry(key) {
  const all = getCustomSnippets();
  delete all[key];
  localStorage.setItem(CUSTOM_SNIPPETS_KEY, JSON.stringify(all));
}

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

    // ১. কাস্টম ডিকশনারি ও ইউজার+বিল্ট-ইন স্নিপেট সংগ্রহ
    const dict = LANGUAGE_DICTIONARIES[mode] || [];
    const customSnippets = getCustomSnippets();
    const allSnippets = { ...CODE_SNIPPETS, ...customSnippets };

    const snippetKeys = Object.entries(allSnippets)
      .filter(([, s]) => s.lang === 'all' || s.lang === mode || !s.lang)
      .map(([k, s]) => ({
        text: typeof s === 'string' ? s : s.code,
        displayText: `⚡ Snippet: ${k}`
      }));

    // ২. ফাইলের ভেতরে আগে লেখা শব্দগুলো সংগ্রহ করা (anyword)
    const anywordResult = CodeMirror.hint.anyword(editor) || { list: [] };

    // ৩. HTML/CSS/JS/SQL হলে বিল্ট-ইন হিন্টও যুক্ত করা
    let builtInList = [];
    if (mode === "htmlmixed" && CodeMirror.hint.html) {
      builtInList = (CodeMirror.hint.html(editor)?.list || []);
    } else if (mode === "css" && CodeMirror.hint.css) {
      builtInList = (CodeMirror.hint.css(editor)?.list || []);
    } else if (mode === "javascript" && CodeMirror.hint.javascript) {
      builtInList = (CodeMirror.hint.javascript(editor)?.list || []);
    } else if (mode === "sql" && CodeMirror.hint.sql) {
      builtInList = (CodeMirror.hint.sql(editor)?.list || []);
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
  editor.on("inputRead", (cm, change) => {
    if (change.origin !== "+input") return;
    const ch = change.text[0];
    if (/[a-zA-Z_<]/.test(ch) && !cm.state.completionActive) {
      cm.showHint({ hint: CodeMirror.hint.smartHint, completeSingle: false });
    }
  });
}
