// Life OS — Supabase client.
// Only external dependency of the whole app: @supabase/supabase-js@2 via CDN (no build step).
// Static site → no env-var injection in the browser: fill in your project values below.
// The same two values are documented in .env.example for the future /api serverless phase.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
