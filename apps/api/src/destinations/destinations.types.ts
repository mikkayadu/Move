export interface SavedDestination {
  id: string;
  label: string;
  address: string;
  lat: number;
  lon: number;
  /** Whether the background job watches this destination for a good window. */
  notify: boolean;
  createdAt: string;
}
