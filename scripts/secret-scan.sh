#!/usr/bin/env bash
#
# Blocks master-key material from entering the repository.
#
# One implementation, two callers:
#   scripts/secret-scan.sh            -- whole index (CI backstop)
#   scripts/secret-scan.sh --staged   -- only what is about to be committed
#                                        (.githooks/pre-commit)
#
# WHY: this repository published a real MASTER_KEYS value in
# backend/.env.example and could not take it back -- the repo is public and
# forked, so the key is public permanently. See SECURITY.md. A master key is
# exactly 64 hex characters, so that is what we look for.
#
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# 32 байти в hex — рівно стільки, скільки має майстер-ключ.
PATTERN='[0-9a-fA-F]{64}'

# 64 однакові символи (aaaa…, 1111…) — це плейсхолдер у документації, а не
# ключ. Коротший запис ([0-9a-f])\1{63} був би бекреференсом, а це GNU-
# розширення ERE: на macOS такий шаблон падає. Тому перелічуємо всі 16 цифр.
PLACEHOLDER=''
for c in 0 1 2 3 4 5 6 7 8 9 a b c d e f; do
  PLACEHOLDER="${PLACEHOLDER}|${c}{64}"
done
PLACEHOLDER="${PLACEHOLDER#|}"

# integrity-хеші в lock-файлах ключами не є.
EXCLUDE=':!*package-lock.json'

# git grep: 0 = знайшов, 1 = не знайшов, >1 = помилка. Розрізняти обовʼязково.
# «|| true» на весь виклик перетворив би будь-яку помилку (кривий прапорець,
# зламаний pathspec) на тихий ПРОХІД — тобто вимкнув би цю перевірку, не
# сказавши нікому. Охоронець, що мовчки пропускає, гірший за його відсутність.
run_grep() {
  local out status
  set +e
  out="$("$@")"
  status=$?
  set -e

  if [ "$status" -gt 1 ]; then
    echo "secret-scan: git grep failed (exit $status) — refusing to pass." >&2
    exit 2
  fi
  printf '%s' "$out"
}

if [ "${1:-}" = '--staged' ]; then
  scope='staged changes'

  # Тільки те, що додається цим комітом. Скан усього індексу теж спрацював би,
  # але блокував би коміт через чужий файл, якого ти не чіпав.
  files=()
  while IFS= read -r f; do
    files+=("$f")
  done < <(git diff --cached --name-only --diff-filter=ACM)

  if [ ${#files[@]} -eq 0 ]; then
    exit 0
  fi

  # --cached СТОЇТЬ ПЕРЕД шаблоном: після шаблону git читає аргументи як
  # ревізії й падає з "unable to resolve revision: --cached".
  # Сам прапорець критичний — він читає версію з ІНДЕКСУ, тож
  # `git add key.env && rm key.env` не проскочить повз перевірку.
  found="$(run_grep git grep --cached -nIE "$PATTERN" -- "${files[@]}" "$EXCLUDE")"
else
  scope='tracked files'
  found="$(run_grep git grep -nIE "$PATTERN" -- "$EXCLUDE")"
fi

hits="$(printf '%s' "$found" | grep -vE "$PLACEHOLDER" || true)"

if [ -n "$hits" ]; then
  echo "$hits" >&2
  cat >&2 <<'EOF'

A 64-hex literal was found — this looks like master key material.

  - Remove it. An example file must never carry a real key.
  - If it was ever used, treat every secret encrypted under it as disclosed
    and follow the recovery path in SECURITY.md.
  - Generate keys per environment, outside the repo:

      echo "v1:$(openssl rand -hex 32)"

EOF
  exit 1
fi

echo "secret-scan: no key material found in ${scope}."
