import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qwkmzfynwfkuvymgbbro.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3a216Znlud2ZrdXZ5bWdiYnJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4ODQzMzIsImV4cCI6MjA5MTQ2MDMzMn0.53CDUf5UJ7oEh9LZRYZZLPnqn-Y546kDobPyivYx58M';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase.from('plan_limits').select('*');
  console.log('Error:', error);
  console.log('Data:', data);
}

check();
