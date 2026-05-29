const replacements = [
  ["K�benhavn", "København"],
  ["K�benhavns", "Københavns"],
  ["k�benhavn", "københavn"],
  ["L�gerne", "Lægerne"],
  ["Malm�", "Malmö"],
  ["Sk�ne", "Skåne"],
  ["S�dra", "Södra"],
  ["H�lsa", "Hälsa"],
  ["sjukv�rd", "sjukvård"],
  ["f�r", "för"],
  ["F�rs�kringskassan", "Försäkringskassan"],
  ["Aff�rs", "Affärs"],
  ["Konstrukt�r", "Konstruktör"],
  ["G�teborg", "Göteborg"],
  ["Regionn�t", "Regionnät"],
  ["kundm�te", "kundmöte"],
  ["Ã¸", "ø"],
  ["Ã˜", "Ø"],
  ["Ã¦", "æ"],
  ["Ã†", "Æ"],
  ["Ã¥", "å"],
  ["Ã…", "Å"],
  ["Ã¤", "ä"],
  ["Ã„", "Ä"],
  ["Ã¶", "ö"],
  ["Ã–", "Ö"],
  ["MalmÃ¶", "Malmö"],
  ["SkÃ¥ne", "Skåne"],
  ["KÃ¸benhavn", "København"],
  ["affÃ¤rs", "affärs"],
  ["AffÃ¤rs", "Affärs"],
  ["broingenjÃ¶r", "broingenjör"],
  ["BroingenjÃ¶r", "Broingenjör"],
  ["regionnÃ¤t", "regionnät"],
  ["RegionnÃ¤t", "Regionnät"],
  ["â€“", "-"],
  ["â€”", "-"],
  ["â†’", "->"],
  ["âœ…", "Yes"],
];

export function repairText(value = "") {
  let text = String(value);
  for (const [broken, fixed] of replacements) {
    text = text.replaceAll(broken, fixed);
  }
  return text.normalize("NFC");
}
