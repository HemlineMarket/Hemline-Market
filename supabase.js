import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Project URL from Supabase
const SUPABASE_URL = 'https://clkizksbvxjkoatdajgd.supabase.co'

// Replace this with your real anon public key in the next step
const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
