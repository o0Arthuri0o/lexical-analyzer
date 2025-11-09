import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

// --- Парсер/интерпретатор выражений (числа — hex) ---
// Простой рекурсивный парсер с приоритетами: * / выше + -; поддерживает скобки.

class Parser {
  tokens: Token[];
  pos: number;
  vars: Record<string, number>; // таблица переменных (значения в decimal)
  error?: string;

  constructor(tokens: Token[], vars: Record<string, number>) {
    this.tokens = tokens;
    this.pos = 0;
    this.vars = vars;
  }

  peek() {
    return this.tokens[this.pos];
  }
  consume(): Token | undefined {
    return this.tokens[this.pos++];
  }

  // entry point
  parseExpression(): number | null {
    const val = this.parseAddSub();
    if (this.error) return null;
    if (this.pos < this.tokens.length) {
      // неожиданные токены
      this.error = `Unexpected token '${this.tokens[this.pos].value}' at position ${this.tokens[this.pos].pos}`;
      return null;
    }
    return val;
  }

  parseAddSub(): number | null {
    let left = this.parseMulDiv();
    if (this.error) return null;
    while (this.pos < this.tokens.length && this.peek().type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.consume()!.value;
      const right = this.parseMulDiv();
      if (this.error || right === null || left === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  parseMulDiv(): number | null {
    let left = this.parseFactor();
    if (this.error) return null;
    while (this.pos < this.tokens.length && this.peek().type === "op" && (this.peek().value === "*" || this.peek().value === "/")) {
      const op = this.consume()!.value;
      const right = this.parseFactor();
      if (this.error || right === null || left === null) return null;
      if (op === "/") {
        if (right === 0) {
          this.error = "Division by zero";
          return null;
        }
        left = Math.floor(left / right);
      } else {
        left = left * right;
      }
    }
    return left;
  }

  parseFactor(): number | null {
    if (this.pos >= this.tokens.length) {
      this.error = "Expression is incomplete";
      return null;
    }
    const tok = this.peek();
    if (tok.type === "hex") {
      // Проверяем валидность hex-числа: должно содержать только 0-9 и a-f (и начинаться с цифры)
      if (!/^[0-9][0-9a-f]*$/.test(tok.value)) {
        this.error = `Invalid hex literal '${tok.value}'`;
        return null;
      }
      this.consume();
      return parseInt(tok.value, 16);
    }
    if (tok.type === "identifier") {
      // идентификатор не может начинаться с заглавной буквы
      if (/^[A-Z]/.test(tok.value)) {
        this.error = `Identifier '${tok.value}' cannot start with uppercase letter`;
        return null;
      }
      this.consume();
      if (!(tok.value in this.vars)) {
        this.error = `Undefined variable '${tok.value}'`;
        return null;
      }
      return this.vars[tok.value];
    }
    if (tok.type === "lparen") {
      this.consume();
      const val = this.parseAddSub();
      if (this.error) return null;
      if (this.pos >= this.tokens.length || this.peek().type !== "rparen") {
        this.error = "Missing closing parenthesis";
        return null;
      }
      this.consume();
      return val;
    }

    this.error = `Unexpected token '${tok.value}'`;
    return null;
  }
}

// --- Высокоуровневая обработка текста: разбить на строки/операторы по ';' и выполнить ---
function processProgram(text: string) {
  const results: { raw: string; status: "accepted" | "cancel"; message?: string }[] = [];
  const vars: Record<string, number> = {};

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
        const res = processStatement(statementRaw, vars);
        results.push({ raw: statementRaw + ";", status: res.ok ? "accepted" : "cancel", message: res.ok ? undefined : res.err });
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
    const res = processStatement(statementRaw, vars);
    results.push({ raw: statementRaw + (res.ok ? ";" : ""), status: res.ok ? "accepted" : "cancel", message: res.ok ? undefined : res.err });
  }

  return { results, vars };
}

// processStatement: анализ токенов одной логической части (без завершающего ';')
function processStatement(statement: string, vars: Record<string, number>) {
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
    // (Убрано) идентификаторы не трактуем как hex по виду
    
    // Преобразуем токены: отфильтровать комментарии внутри правой части (неожиданно), неизвестные — ошибка
    for (const t of tokens) {
      if (t.type === "unknown") return { ok: false, err: `Unknown token '${t.value}' in expression` };
      if (t.type === "comment") {
        // комментарий внутри выражения — некорректно (в языке комментарий заканчивается ';')
        return { ok: false, err: "Comment inside expression is not allowed (must end with ';')" };
      }
    }
    const parser = new Parser(tokens, vars);
    const val = parser.parseExpression();
    if (parser.error || val === null) {
      const msg = parser.error || "Parse error";
      // Семантические ошибки (не влияют на accepted): неопределенная переменная, деление на ноль
      if (/Undefined variable|Division by zero/.test(msg)) {
        return { ok: true, err: msg };
      }
      // Остальное считаем синтаксической ошибкой
      return { ok: false, err: msg };
    }
    // если всё успешно — присваиваем значение
    vars[leftRaw] = val;
    return { ok: true };
  }

  // Если нет ':=' — это выражение или число или идентификатор или ошибка
  const tokens = tokenizeLine(statement);
  // (Убрано) идентификаторы не трактуем как hex по виду
  
  if (tokens.length === 0) return { ok: true }; // пусто
  // Если это просто hex или identifier (без операций) — проверим корректность
  if (tokens.length === 1) {
    const t = tokens[0];
    if (t.type === "hex") {
      // проверка корректности hex
      if (!/^[0-9][0-9a-f]*$/.test(t.value)) return { ok: false, err: `Invalid hex literal '${t.value}'` };
      return { ok: true };
    }
    if (t.type === "identifier") {
      if (/^[A-Z]/.test(t.value)) return { ok: false, err: `Identifier '${t.value}' cannot start with uppercase letter` };
      return { ok: true };
    }
    return { ok: false, err: `Invalid standalone token '${t.value}'` };
  }

  // Иначе — пытаемся распарсить как выражение
  for (const t of tokens) if (t.type === "unknown") return { ok: false, err: `Unknown token '${t.value}'` };
  const parser = new Parser(tokens, vars);
  const val = parser.parseExpression();
  if (parser.error || val === null) {
      const msg = parser.error || "Parse error";
      // Семантические ошибки (не влияют на accepted): неопределенная переменная, деление на ноль
      if (/Undefined variable|Division by zero/.test(msg)) {
        return { ok: true, err: msg };
      }
      // Остальное считаем синтаксической ошибкой
      return { ok: false, err: msg };
    }
  return { ok: true };
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
  const [lastResult, setLastResult] = useState<{ results: any[]; vars: Record<string, number> } | null>(null);

  const run = () => {
    const res = processProgram(text);
    setLastResult(res);
  };

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
            {lastResult ? (
              <div>
                <div className="mb-3">
                  <strong>Строки:</strong>
                  <ul className="list-disc pl-6">
                    {lastResult.results.map((r, idx) => (
                      <li key={idx}>
                        <code>{r.raw}</code> — <strong>{r.status}</strong>
                        {r.message ? <span>: {r.message}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Переменные (в конце выполнения):</strong>
                  <ul className="list-disc pl-6">
                    {Object.keys(lastResult.vars).length === 0 && <li> (нет переменных) </li>}
                    {Object.entries(lastResult.vars).map(([k, v]) => (
                      <li key={k}>
                        {k} = {v} (0x{v.toString(16)})
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

      {/* Простая легенда стилей подсветки */}
      <style>{`
        .tk-comment { color: #6b7280; }
        .tk-id { color: #0ea5a4; }
        .tk-hex { color: #f97316; }
        .tk-op { color: #ef4444; }
        .tk-assign { color: #7c3aed; }
        .tk-par { color: #3b82f6; }
        .tk-err { text-decoration: underline; text-decoration-color: #ef4444; }
      `}</style>
    </div>
  );
}
