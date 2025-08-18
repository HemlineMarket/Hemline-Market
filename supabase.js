// Import the Supabase client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Replace these with your actual Supabase project values
const SUPABASE_URL = 'https://YOUR-PROJECT-URL.supabase.co'
const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY'

// Create client
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
