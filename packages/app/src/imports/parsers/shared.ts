export function parseCsvLine(line: string, delimiter = ","): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export function extractTag(block: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}>([^<\\r\\n]+)(?:<\\/${tag}>)?`, "i");
  const match = regex.exec(block);
  return match ? match[1]?.trim() : undefined;
}
