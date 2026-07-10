// Dominik's Dashboard — Supabase client.
// Only external dependency of the whole app: @supabase/supabase-js@2 via CDN (no build step).
// Static site → no env-var injection in the browser: fill in your project values below.
// The same two values are documented in .env.example for the future /api serverless phase.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://ievuxqksyhemdkzyzlkg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlldnV4cWtzeWhlbWRrenl6bGtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NDE2MDQsImV4cCI6MjA5OTAxNzYwNH0.-Ufs6JnP6EuM4pUfOUqogI94yQRvo4jbTiH2mzUHQ-w';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
