export const MIN_WORDS = 40;
export const MAX_SAMPLES = 8;
export const DISTANCE_LIMIT = 0.35;

function validSamples(samples) {
  return Array.isArray(samples) && samples.length <= MAX_SAMPLES &&
    samples.every(s => s && typeof s.id === 'string' && /^[1-9][0-9]{0,18}$/.test(s.id) &&
      typeof s.text === 'string' && s.text.length <= 1000 && s.text.trim()) &&
    new Set(samples.map(s => s.id)).size === samples.length;
}

function distribution(values, size) {
  const bins = Array(size).fill(0);
  for (const value of values) bins[value]++;
  return bins.map(count => count / (values.length || 1));
}

function describe(samples) {
  const text = samples.map(s => s.text.normalize('NFC')).join('\n');
  const words = text.match(/\p{L}+/gu) ?? [];
  const letters = words.join('');
  const punctuation = ['.', ',', '!', '?', ':', ';', '…'];
  const trigrams = words.flatMap(word => {
    const chars = [...word.toLocaleLowerCase('tr')];
    return chars.slice(2).map((_, i) => {
      const hash = chars.slice(i, i + 3).reduce((acc, char) => acc * 31 + char.codePointAt(0), 0);
      return hash % 128;
    });
  });
  return {
    count: words.length,
    uppercase: (letters.match(/\p{Lu}/gu)?.length ?? 0) / Math.max(1, [...letters].length),
    punctuation: punctuation.map(mark => Math.min(1, (text.split(mark).length - 1) / Math.max(1, words.length))),
    lengths: distribution(words.map(word => Math.min(7, [...word].length - 1)), 8),
    trigrams: distribution(trigrams, 128),
  };
}

export function hasEnoughText(samples) {
  return validSamples(samples) && samples.length >= 2 && describe(samples).count >= MIN_WORDS;
}

function histogramDistance(a, b) {
  return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / 2;
}

export function verifyAuthor(examples, candidates) {
  if (!validSamples(examples) || !validSamples(candidates)) throw new Error('Geçersiz mesaj seçimi veya yazım profili.');
  const a = describe(examples), b = describe(candidates);
  if (examples.length < 2 || candidates.length < 2 || a.count < MIN_WORDS || b.count < MIN_WORDS) return { status: 'insufficient' };
  const latestExample = examples.reduce((latest, sample) => BigInt(sample.id) > latest ? BigInt(sample.id) : latest, 0n);
  if (candidates.some(sample => BigInt(sample.id) <= latestExample)) {
    throw new Error('Örneklerden sonra gönderilen mesajları seçin.');
  }
  const caps = Math.min(1, Math.abs(a.uppercase - b.uppercase) * 4);
  const marks = Math.min(1, a.punctuation.reduce((sum, rate, index) => sum + Math.abs(rate - b.punctuation[index]), 0) * 2);
  const distance = 0.2 * caps + 0.25 * marks + 0.25 * histogramDistance(a.lengths, b.lengths) + 0.3 * histogramDistance(a.trigrams, b.trigrams);
  return { status: distance < DISTANCE_LIMIT ? 'match' : 'difference', distance };
}
