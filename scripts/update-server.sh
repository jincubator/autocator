#!/bin/bash

# This script updates the autocator server with the latest changes
# It should be run from your local development environment after making changes

# Check if domain is provided
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <domain>"
    echo "Example: $0 autocator.org"
    exit 1
fi

DOMAIN=$1
PROJECT_DIR="/opt/autocator"
SSH_USER="root"  # Change this if you use a different user

# Build the project locally
echo "Building project locally..."
pnpm build

# Copy the updated files to the server
echo "Copying files to server..."
scp -r dist/* $SSH_USER@$DOMAIN:$PROJECT_DIR/dist/

# SSH into the server and restart the service
echo "Restarting service on server..."
ssh $SSH_USER@$DOMAIN << EOF
    systemctl restart autocator
    echo "Service restarted. Checking status..."
    systemctl status autocator
EOF

echo "Update complete!"
echo "You can monitor the server with:"
echo "ssh $SSH_USER@$DOMAIN 'journalctl -u autocator -f'"
