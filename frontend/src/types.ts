export interface SessionResponse {
  id: string;
  client_secret: {
    value: string;
    expires_at: number;
  };
  [key: string]: unknown;
}
