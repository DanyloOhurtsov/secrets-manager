// Невеликий парсер .env для bulk-імпорту секретів. Винесено окремо (без побічних
// ефектів і без залежності від Nest), щоб його було легко юніт-тестувати.
//
// Підтримує типові .env-файли: коментарі (#...), порожні рядки, необов'язковий
// префікс `export `, KEY=VALUE, значення в одинарних/подвійних лапках (для
// подвійних — базові escape \n \r \t \" \\). НЕ підтримує багаторядкові значення
// та інлайн-коментарі після незакавиченого значення — це свідоме спрощення MVP.

export interface ParsedEnvEntry {
  key: string;
  value: string;
}

export interface ParsedEnv {
  // Дедуплікований список (останнє значення для ключа перемагає, як при source .env).
  entries: ParsedEnvEntry[];
  // Людяні повідомлення про рядки, які не вдалося розпарсити (з номером рядка).
  errors: string[];
}

// Валідний ключ змінної оточення: літера/підкреслення, далі літери/цифри/підкреслення.
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseDotenv(content: string): ParsedEnv {
  // Map зберігає порядок першої вставки, але значення перезаписується — отже
  // дублікати ключів схлопуються, останнє значення перемагає.
  const map = new Map<string, string>();
  const errors: string[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    let line = rawLine.trim();
    if (line === '' || line.startsWith('#')) return;

    if (line.startsWith('export ')) line = line.slice('export '.length).trim();

    const eq = line.indexOf('=');
    if (eq === -1) {
      errors.push(`Line ${lineNo}: expected KEY=VALUE`);
      return;
    }

    const key = line.slice(0, eq).trim();
    if (!KEY_RE.test(key)) {
      errors.push(`Line ${lineNo}: invalid key "${key}"`);
      return;
    }

    map.set(key, unquote(line.slice(eq + 1).trim()));
  });

  return {
    entries: [...map].map(([key, value]) => ({ key, value })),
    errors,
  };
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    // Подвійні лапки: знімаємо й обробляємо базові escape-послідовності.
    if (first === '"' && last === '"') {
      return value
        .slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
    // Одинарні лапки: значення береться буквально, без escape.
    if (first === "'" && last === "'") {
      return value.slice(1, -1);
    }
  }
  return value;
}
