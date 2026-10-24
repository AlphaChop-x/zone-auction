export function itemName(name) {
  const value = name?.type === 'translation' ? name.lines?.ru
    : name?.type === 'text' ? name.text : undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error('Missing RU name');
  return value.trim();
}
