-- Add daily_capacity to users table with a default value of 8 hours.
ALTER TABLE users ADD COLUMN daily_capacity REAL DEFAULT 8.0;

-- Update the default user to ensure they have a capacity.
UPDATE users SET daily_capacity = 8.0 WHERE id = 1 AND daily_capacity IS NULL;
