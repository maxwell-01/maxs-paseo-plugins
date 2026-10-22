const WHOLE_NUMBER = /^-?\d+$/;

const idTexts = (text: string) =>
  text
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

export const parseIds = (text: string) => idTexts(text).map(Number);

export const isIdList = (text: string) => idTexts(text).every((id) => WHOLE_NUMBER.test(id) && Number.isSafeInteger(Number(id)));
