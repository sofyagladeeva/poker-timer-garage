const RU_TO_EN: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd',
  'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z', 'и': 'i',
  'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n',
  'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't',
  'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch',
  'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '',
  'э': 'e', 'ю': 'yu', 'я': 'ya',
};

const EN_TO_RU: Record<string, string> = {
  'a': 'а', 'b': 'б', 'v': 'в', 'g': 'г', 'd': 'д',
  'e': 'е', 'z': 'з', 'i': 'и', 'y': 'й', 'k': 'к',
  'l': 'л', 'm': 'м', 'n': 'н', 'o': 'о', 'p': 'п',
  'r': 'р', 's': 'с', 't': 'т', 'u': 'у', 'f': 'ф',
  'h': 'х', 'c': 'к',
};

function ruToEn(str: string): string {
  return str.split('').map(ch => RU_TO_EN[ch] ?? ch).join('');
}

function enToRu(str: string): string {
  return str.split('').map(ch => EN_TO_RU[ch] ?? ch).join('');
}

export function matchesSearchQuery(text: string, query: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  if (ruToEn(t).includes(ruToEn(q))) return true;
  if (enToRu(t).includes(enToRu(q))) return true;
  return false;
}
