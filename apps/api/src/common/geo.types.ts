export interface Coordinates {
  lat: number;
  lon: number;
}

export interface Place extends Coordinates {
  /** Short name, e.g. "Accra Mall". */
  name: string;
  /** Full formatted address when the provider gives us one. */
  address: string;
  /**
   * Coarse label for what kind of thing this is - "Shopping mall",
   * "University", "Town". Shown in the search list so a user can tell the
   * Achimota suburb apart from Achimota School.
   */
  category?: string;
}
