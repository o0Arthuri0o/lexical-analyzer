import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge"

// --- Типы токенов ---
type TokenType =
  | "identifier"
  | "hex"
  | "op"
  | "assign"
  | "lparen"
  | "rparen"
  | "semicolon"
  | "comment"
  | "unknown";

type Token = { type: TokenType; value: string; pos: number };

// --- Утилиты для проверки лексем по грамматике ---
const isIdentifierStart = (ch: string) => ch === "_" || (ch >= "a" && ch <= "z");
const isAlpha = (ch: string) => (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
const isDigit = (ch: string) => ch >= "0" && ch <= "9";

// --- Простейший лексер, возвращающий токены одной строки (без терминатора ;) ) ---
function tokenizeLine(line: string, basePos = 0): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = line.length;

  while (i < n) {
    const ch = line[i];

    // Пробелы — пропускаем
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }

    // Комментарий: строка, начинающаяся с // — весь остаток считается комментарием
    if (ch === "/" && i + 1 < n && line[i + 1] === "/") {
      const rest = line.slice(i); // оставшаяся часть
      tokens.push({ type: "comment", value: rest, pos: basePos + i });
      break; // комментарий до конца строки
    }

    // Двоеточие и :=
    if (ch === ":") {
      if (i + 1 < n && line[i + 1] === "=") {
        tokens.push({ type: "assign", value: ":=", pos: basePos + i });
        i += 2;
      } else {
        tokens.push({ type: "unknown", value: ":", pos: basePos + i });
        i++;
      }
      continue;
    }

    // Скобки
    if (ch === "(") {
      tokens.push({ type: "lparen", value: ch, pos: basePos + i });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ch, pos: basePos + i });
      i++;
      continue;
    }

    // Операторы
    if ("+-*/".includes(ch)) {
      tokens.push({ type: "op", value: ch, pos: basePos + i });
      i++;
      continue;
    }

    // Идентификатор (начинается с _ или строчной буквы)
    if (isIdentifierStart(ch)) {
      let j = i + 1;
      while (j < n && (isAlpha(line[j]) || isDigit(line[j]) || line[j] === "_")) j++;
      const val = line.slice(i, j);
      tokens.push({ type: "identifier", value: val, pos: basePos + i });
      i = j;
      continue;
    }

    // Число в шестнадцатеричной системе (должно начинаться с цифры и содержать 0-9, a-f)
    if (isDigit(ch)) {
      let j = i + 1;
      while (j < n && (isDigit(line[j]) || (line[j] >= "a" && line[j] <= "f"))) j++;
      const val = line.slice(i, j);
      tokens.push({ type: "hex", value: val, pos: basePos + i });
      i = j;
      continue;
    }

    // Если ни одно не подошло — считаем неизвестным
    tokens.push({ type: "unknown", value: ch, pos: basePos + i });
    i++;
  }

  return tokens;
}

// Валидатор последовательности токенов
function validateExpressionTokens(tokens: Token[]): { ok: true } | { ok: false; err: string } {
  // Базовые проверки
  for (const t of tokens) {
    if (t.type === "unknown") return { ok: false, err: `Unknown token '${t.value}'` };
    if (t.type === "comment") return { ok: false, err: "Comment inside expression is not allowed (must end with ';')" };
  }
  // Пустое выражение — ошибка
  if (tokens.length === 0) return { ok: false, err: "Expression is incomplete" };
 
  // Проверка баланса скобок и порядка: ожидаем операнд/скобку или оператор/закрывающую скобку
  let expectOperand = true;
  let depth = 0;
 
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (expectOperand) {
      if (t.type === "hex") {
        if (!/^[0-9][0-9a-f]*$/.test(t.value)) return { ok: false, err: `Invalid hex literal '${t.value}'` };
        expectOperand = false;
        continue;
      }
      if (t.type === "identifier") {
        if (/^[A-Z]/.test(t.value)) return { ok: false, err: `Identifier '${t.value}' cannot start with uppercase letter` };
        expectOperand = false;
        continue;
      }
      if (t.type === "lparen") {
        depth++;
        expectOperand = true;
        continue;
      }
      return { ok: false, err: `Unexpected token '${t.value}'` };
    } else {
      if (t.type === "op") {
        if (t.value !== "+" && t.value !== "-" && t.value !== "*" && t.value !== "/") {
          return { ok: false, err: `Unexpected token '${t.value}'` };
        }
        expectOperand = true;
        continue;
      }
      if (t.type === "rparen") {
        if (depth === 0) return { ok: false, err: "Missing opening parenthesis" };
        depth--;
        expectOperand = false;
        continue;
      }
      return { ok: false, err: `Unexpected token '${t.value}'` };
    }
  }
 
  if (depth !== 0) return { ok: false, err: "Missing closing parenthesis" };
  if (expectOperand) return { ok: false, err: "Expression is incomplete" };
  return { ok: true };
}

// --- Высокоуровневая обработка текста: разбить на строки/операторы по ';' и выполнить ---
function processProgram(text: string) {
  const results: { raw: string; status: "accepted" | "cancel"; message?: string, tokens?: Token[] }[] = [];
  // Переменные и вычисления удалены — оставляем только лексический/синтаксический статус строки.

  // Разделяем по ';' — в языке ';' является разделителем/терминатором.
  // Мы сохраняем текст между точками с запятой.
  let idx = 0;
  let current = "";
  while (idx < text.length) {
    const ch = text[idx];
    current += ch;
    if (ch === ";") {
      const statementRaw = current.slice(0, -1).trim(); // без ';'
      if (statementRaw.length > 0) {
        // Обработка одной строки/оператора
        const res = processStatement(statementRaw);
        results.push({ raw: statementRaw + ";", status: res.ok ? "accepted" : "cancel", message: res.ok ? undefined : res.err, tokens: res.tokens });
      } else {
        // пустой оператор — игнорируем
      }
      current = "";
    }
    idx++;
  }

  // Если в конце нет завершающего ';', считаем это ошибкой для последней незавершённой строки
  if (current.trim().length > 0) {
    const statementRaw = current.trim();
    const res = processStatement(statementRaw);
    results.push({ raw: statementRaw + (res.ok ? ";" : ""), status: res.ok ? "accepted" : "cancel", message: res.ok ? undefined : res.err, tokens: res.tokens });
  }

  // Не возвращаем переменные наружу — результаты переменных не сохраняем и не вычисляем для вывода
  return { results };
}

// processStatement: анализ токенов одной логической части (без завершающего ';')
function processStatement(statement: string) {
  // Если комментарий (начинается с //) — автоматически принимаем
  const trimmed = statement.trim();
  if (trimmed.startsWith("//")) {
    return { ok: true };
  }

  // Ищем оператор присваивания ':='
  const assignIndex = statement.indexOf(":=");
  if (assignIndex >= 0) {
    const leftRaw = statement.slice(0, assignIndex).trim();
    const rightRaw = statement.slice(assignIndex + 2).trim();
    // Левый операнд должен быть идентификатором
    if (!/^[a-z_][A-Za-z0-9_]*$/.test(leftRaw)) {
      return { ok: false, err: `Left side of := must be identifier (got '${leftRaw}')` };
    }
    // Идентификатор не должен начинаться с заглавной буквы
    if (/^[A-Z]/.test(leftRaw)) return { ok: false, err: `Identifier '${leftRaw}' cannot start with uppercase letter` };
    // Парсим правую часть как выражение
    const tokens = tokenizeLine(rightRaw);
    const valid = validateExpressionTokens(tokens);
    if (!valid.ok) return { ok: false, err: valid.err, tokens };
    return { ok: true, tokens };
  }

  // Если нет ':=' — это выражение или число или идентификатор или ошибка
  const tokens = tokenizeLine(statement);
  if (tokens.length === 0) return { ok: true }; // пусто
  const valid = validateExpressionTokens(tokens);
  if (!valid.ok) return { ok: false, err: valid.err, tokens };
  return { ok: true , tokens};
}

// --- Компоненты UI ---

function HighlightedEditor({ text, onChange }: { text: string; onChange: (v: string) => void }) {
  return (
    <div className="w-full h-full flex flex-col">
      {/* собственно textarea для ввода */}
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-64 p-2 font-mono bg-transparent resize-none outline-none text-sm"
        spellCheck={false}
      />
    </div>
  );
}

export default function App() {
  const [text, setText] = useState<string>(`abc := 1a5 + 2f;\n_var := 0ff * (x - 1b);\n// This is a comment;\nnew := a + b * 2;\nundef := 5 + ;\n`);
  const [results, setResults] = useState<{ raw: string; status: "accepted" | "cancel"; message?: string, tokens?: Token[] }[] | null>(null);

  const run = () => {
    const res = processProgram(text);
    setResults(res.results);
  };

  const typeColor = useCallback((type: TokenType) => {
    switch(type) {
      case 'identifier': 
        return '#4b5563';
      case 'assign':
        return '#0284c7';
      case 'hex': 
        return '#7c3aed';
      case 'lparen':
        return '#525252';
      case 'rparen':
        return '#525252';
      case 'op':
        return '#c026d3';
      case 'comment': 
        return '#16a34a';
      case 'semicolon':
        return '#475569';
      case 'unknown':
        return '#dc2626';
      default:
        return '#dc2626';
    }
  }, [])

  return (
    <div className="p-6 min-h-screen bg-background">
      <h1 className="text-2xl mb-4">Лексический анализатор — вариант №13</h1>
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Исходный текст</CardTitle>
          </CardHeader>
          <CardContent>
            <HighlightedEditor text={text} onChange={setText} />
          </CardContent>
          <Button className="mx-2" onClick={run}>Запустить</Button>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Результат</CardTitle>
          </CardHeader>
          <CardContent>
            {results ? (
              <div>
                <div className="mb-3">
                  <strong>Строки:</strong>
                  <ul className="list-disc pl-6">
                    {results.map((r, idx) => (
                      <li key={idx}>
                        <code>{r.raw}</code> — <strong>{r.status}</strong>
                        {r.message ? <span>: {r.message}</span> : null}
                        {r.tokens && (<div style={{display: 'flex'}}>
                          {r.tokens.map(token => <Badge style={{ background: typeColor(token.type)}} >{token.value} : {token.type}</Badge>)}
                        </div>)}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div>Нажмите «Запустить», чтобы получить результат.</div>
            )}
          </CardContent>
        </Card>
      </div>
      {/* Таблица лексем языка */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Таблица лексем языка</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-4">Лексема</th>
                  <th className="py-2 pr-4">Описание</th>
                  <th className="py-2">Примеры</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="py-2 pr-4"><code>identifier</code></td>
                  <td className="py-2 pr-4">Идентификатор: начинается с <code>_</code> или строчной буквы, далее буквы/цифры/_</td>
                  <td className="py-2"><code>abc</code>, <code>_var1</code></td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-4"><code>hex</code></td>
                  <td className="py-2 pr-4">Шестнадцатеричное число: только <code>0-9</code>, <code>a-f</code>, начинается с цифры</td>
                  <td className="py-2"><code>1a5</code>, <code>2f</code>, <code>0ff</code></td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-4"><code>op</code></td>
                  <td className="py-2 pr-4">Арифметические операторы</td>
                  <td className="py-2"><code>+</code>, <code>-</code>, <code>*</code>, <code>/</code></td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-4"><code>assign</code></td>
                  <td className="py-2 pr-4">Оператор присваивания</td>
                  <td className="py-2"><code>:=</code></td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-4"><code>lparen</code>, <code>rparen</code></td>
                  <td className="py-2 pr-4">Скобки</td>
                  <td className="py-2"><code>(</code>, <code>)</code></td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-4"><code>comment</code></td>
                  <td className="py-2 pr-4">Комментарий до конца строки</td>
                  <td className="py-2"><code>// ...</code></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4"><code>semicolon</code></td>
                  <td className="py-2 pr-4">Разделитель операторов</td>
                  <td className="py-2"><code>;</code></td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
