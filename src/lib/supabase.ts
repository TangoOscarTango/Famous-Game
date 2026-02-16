import { createClient } from '@supabase/supabase-js';


// Initialize database client
const supabaseUrl = 'https://ahtipnirixooabamxrbs.databasepad.com';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImQwNDBlZjBkLWU5OGEtNDc5MS05YTgxLTM5MDY5ZmI0YjY4OCJ9.eyJwcm9qZWN0SWQiOiJhaHRpcG5pcml4b29hYmFteHJicyIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzY5NTQzODQ1LCJleHAiOjIwODQ5MDM4NDUsImlzcyI6ImZhbW91cy5kYXRhYmFzZXBhZCIsImF1ZCI6ImZhbW91cy5jbGllbnRzIn0.YhvdeNpz_vDOVGD8-Wn5nOqvbdy2jpvTtSDzKCzYeGQ';
const supabase = createClient(supabaseUrl, supabaseKey);


export { supabase };