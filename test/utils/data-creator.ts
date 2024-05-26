import crypto from "node:crypto";

/**
 * Generates a random string with the specified length and pattern
 * @param prefix - The prefix to use in the generated string.
 * @param chars - The characters to use in the generated string.
 * @param length - The length of the string to generate.
 * @param isUnique - Whether the generated string should be unique.
 * @param errorMessage - The error message to throw when the length is greater than the number of characters.
 * @returns The generated string.
 */
export function randomValueGenerator(
  prefix: string = "",
  chars: string,
  length: number,
  isUnique: boolean = false,
  errorMessage: string = "Length is greater than the number of characters",
): string {
  if (isUnique && length > chars.length) {
    throw new Error(errorMessage);
  }

  let characters = chars.split("");
  let result = prefix;

  for (let i = 0; i < length; i++) {
    const randomBuffer = crypto.randomBytes(1);
    const index = randomBuffer[0] % characters.length;
    result += characters[index];

    if (isUnique) {
      // Swap the selected character with the last character in the array
      [characters[index], characters[characters.length - 1]] = [
        characters[characters.length - 1],
        characters[index],
      ];
      // Remove the last character from the array
      characters.pop();
    }
  }
  return result;
}

/**
 * Date formats.
 */
export enum DateFormat {
  ISO = "iso",
  UTC = "utc",
  //TODO maybe later can add more date formats here
}

/**
 * Generates a random date between two dates and formats it.
 * @param start - The start date. Defaults to the current date.
 * @param end - The end date. Defaults to one year from the current date.
 * @param formatType - The format of the returned date. Defaults to ISO 8601 format.
 * @returns The generated date.
 */
export function randomDate(
  start: Date = new Date(),
  end: Date = new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
  formatType: DateFormat = DateFormat.ISO,
): string {
  // Generate a random date between the start and end dates
  const date = new Date(
    start.getTime() + Math.random() * (end.getTime() - start.getTime()),
  );

  // Format the date based on the specified format type
  switch (formatType) {
    case DateFormat.ISO:
      // Format the date to ISO 8601 format
      return date.toISOString();
    case DateFormat.UTC:
      // Format the date to UTC format
      return date.toUTCString();
    // Add more case statements here for other date formats
    default:
      // Throw an error if the format type is invalid
      throw new Error(`Invalid format: ${formatType}`);
  }
}

/**
 * Waits for a specific amount of time.
 * @param ms - The amount of time to wait, in milliseconds.
 * @returns A promise that resolves after the specified amount of time.
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ID types.
 */
export enum IDType {
  INT = "int",
  LONG = "long",
  UUID = "uuid",
  //TODO maybe later can add more ID types here
}

/**
 * Generates a random ID of the specified type.
 * @param type - The type of ID to generate.
 * @returns The generated ID.
 * @throws An error if the ID type is invalid.
 * https://nodejs.org/docs/latest-v14.x/api/crypto.html#crypto_crypto_randomuuid_options
 * //TODO: remove "switch" with something better.
 */
export function generateRandomId(idType: IDType): string | number {
  switch (idType) {
    case IDType.INT:
      //Generate a random integer between 0 and 1000
      return Math.floor(Math.random() * 1000);
    case IDType.LONG:
      // Generate a random long integer between 0 and Number.MAX_SAFE_INTEGER
      return Math.floor(Math.random() * (Number.MAX_SAFE_INTEGER + 1));
    case IDType.UUID:
      // Generate a random UUID
      return crypto.randomUUID();
    default:
      throw new Error(`Unsupported ID type: ${idType}`);
  }
}