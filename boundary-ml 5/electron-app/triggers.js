const MAX_TRIGGERS = 50,
  MAX_LENGTH = 100;
function normalize(text) {
  return (
    String(text)
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.join(" ") || ""
  );
}
function clean(list) {
  if (!Array.isArray(list)) throw Error("Invalid trigger list.");
  const seen = new Set(),
    result = [];
  for (const item of list) {
    if (typeof item !== "string") throw Error("Invalid trigger list.");
    const value = item.trim().replace(/\s+/g, " ");
    if (!value) continue;
    if (value.length > MAX_LENGTH)
      throw Error(`Keep each word or phrase under ${MAX_LENGTH} characters.`);
    const key = normalize(value);
    if (!key) throw Error("Each trigger needs at least one letter or number.");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  if (result.length > MAX_TRIGGERS)
    throw Error(`Use up to ${MAX_TRIGGERS} trigger words or phrases.`);
  return result;
}
function matches(list, texts) {
  if (!Array.isArray(list) || !list.length) return [];
  const screen = ` ${normalize(texts.join(" "))} `;
  return list.filter((item) => {
    const key = normalize(item);
    return key && screen.includes(` ${key} `);
  });
}
module.exports = { clean, matches, normalize, MAX_TRIGGERS, MAX_LENGTH };
