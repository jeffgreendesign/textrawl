#!/bin/bash

# Textrawl Setup Script
# Generates .env file with secure defaults

set -e

echo "=== Textrawl Setup ==="
echo

# Check if .env already exists
if [ -f .env ]; then
    echo "Warning: .env file already exists."
    read -p "Overwrite? (y/N): " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        echo "Setup cancelled."
        exit 0
    fi
fi

# Generate secure API token
API_TOKEN=$(openssl rand -hex 32)

# Copy template
cp .env.example .env

# Replace placeholder token
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/^API_BEARER_TOKEN=.*/API_BEARER_TOKEN=$API_TOKEN/" .env
else
    # Linux
    sed -i "s/^API_BEARER_TOKEN=.*/API_BEARER_TOKEN=$API_TOKEN/" .env
fi

echo "Created .env with secure API token."
echo

# Prompt for credentials
echo "Enter your credentials (or press Enter to skip and edit .env later):"
echo

read -p "SUPABASE_URL (e.g., https://abc123.supabase.co): " SUPABASE_URL
if [ -n "$SUPABASE_URL" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^SUPABASE_URL=.*|SUPABASE_URL=$SUPABASE_URL|" .env
    else
        sed -i "s|^SUPABASE_URL=.*|SUPABASE_URL=$SUPABASE_URL|" .env
    fi
fi

read -p "SUPABASE_SERVICE_KEY: " SUPABASE_KEY
if [ -n "$SUPABASE_KEY" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^SUPABASE_SERVICE_KEY=.*|SUPABASE_SERVICE_KEY=$SUPABASE_KEY|" .env
    else
        sed -i "s|^SUPABASE_SERVICE_KEY=.*|SUPABASE_SERVICE_KEY=$SUPABASE_KEY|" .env
    fi
fi

read -p "OPENAI_API_KEY: " OPENAI_KEY
if [ -n "$OPENAI_KEY" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=$OPENAI_KEY|" .env
    else
        sed -i "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=$OPENAI_KEY|" .env
    fi
fi

echo
echo "=== Setup Complete ==="
echo
echo "Your API Bearer Token: $API_TOKEN"
echo "(Save this - you'll need it for authenticated requests)"
echo
echo "Next steps:"
echo "  1. Edit .env if you skipped any credentials"
echo "  2. Run database setup in Supabase SQL Editor:"
echo "     - Open scripts/setup-db.sql"
echo "     - Paste and run in your Supabase dashboard"
echo "  3. Start the dev server: npm run dev"
echo
