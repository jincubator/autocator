#!/bin/bash

# Check if domain and IP are provided
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <domain> <ip>"
    echo "Example: $0 autocator.org 157.230.64.12"
    exit 1
fi

DOMAIN=$1
IP=$2
PROJECT_DIR="/opt/autocator"
EMAIL="your-email@your-email-provider.com"

# Update system and install dependencies
echo "Updating system and installing dependencies..."
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y curl git nginx certbot python3-certbot-nginx

# Install Node.js 20.x
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
echo "Installing pnpm..."
sudo npm install -g pnpm

# Create and prepare project directory
echo "Setting up project directory..."
sudo mkdir -p $PROJECT_DIR
sudo chown -R $USER:$USER $PROJECT_DIR

# Copy current repository to project directory
echo "Copying repository..."
cp -r . $PROJECT_DIR/
cd $PROJECT_DIR

# Install dependencies (but don't build - we'll transfer built files from local machine)
echo "Installing dependencies..."
pnpm install --prod

# Create .env file from example if it doesn't exist
if [ ! -f ".env" ]; then
    echo "Creating .env file from example..."
    cp .env.example .env
    echo "Please edit the .env file with your configuration"
    echo "Especially set the PRIVATE_KEY, ALLOCATOR_ADDRESS, and SIGNING_ADDRESS"
    echo "Press Enter when you've updated the .env file..."
    read
fi

# Create systemd service
echo "Creating systemd service..."
sudo tee /etc/systemd/system/autocator.service > /dev/null << EOL
[Unit]
Description=Autocator Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=autocator
Environment="NODE_ENV=production"
Environment="BASE_URL=https://$DOMAIN"
Environment="PORT=3000"
Environment="CORS_ORIGIN=*"

[Install]
WantedBy=multi-user.target
EOL

# Configure nginx
echo "Configuring nginx..."
sudo tee /etc/nginx/sites-available/autocator > /dev/null << EOL
server {
    server_name $DOMAIN;
    listen 80;
    listen [::]:80;

    root $PROJECT_DIR/dist/frontend;
    index index.html;

    # API endpoints
    location ~ ^/(health|suggested-nonce|compact|compacts|balance|balances|session) {
        # Simple CORS configuration
        add_header 'Access-Control-Allow-Origin' '*';
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS, PUT, DELETE';
        add_header 'Access-Control-Allow-Headers' '*';
        
        # Handle OPTIONS method for CORS preflight
        if (\$request_method = 'OPTIONS') {
            return 204;
        }

        # Proxy to backend
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Frontend files
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOL

# Enable nginx site
sudo ln -sf /etc/nginx/sites-available/autocator /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Update DNS A record
echo "Please ensure the following DNS record is set:"
echo "$DOMAIN. A $IP"
echo "Press Enter when DNS is configured..."
read

# Set up SSL with Let's Encrypt
echo "Setting up SSL certificate..."
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email $EMAIL

# Start services
echo "Starting services..."
sudo systemctl daemon-reload
sudo systemctl enable autocator
sudo systemctl start autocator
sudo systemctl restart nginx

echo "Setup complete!"
echo "Your server is now running at https://$DOMAIN"
echo "Health check endpoint: https://$DOMAIN/health"
echo ""
echo "You can monitor the server with:"
echo "sudo systemctl status autocator"
echo "sudo journalctl -u autocator -f"
