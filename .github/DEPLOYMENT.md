# GitHub Actions Deployment Setup

## Overview

This repository is configured to automatically deploy to Azure App Service on every push to the `main` branch.

## Azure App Service Details

- **App Name:** reportingServiceShell
- **Resource Group:** reportingServiceShell_group (to be created)
- **Subscription ID:** (to be configured)
- **App URL:** https://reportingServiceShell.azurewebsites.net (to be created)

## Required GitHub Secrets

The following secrets must be configured in your GitHub repository:

### AZURE_CLIENT_ID
Azure service principal client ID for authentication.

### AZURE_TENANT_ID
Azure tenant ID for authentication.

### AZURE_SUBSCRIPTION_ID
Azure subscription ID where the App Service is located.

These secrets should be configured in:
**GitHub Repository → Settings → Secrets and variables → Actions → Repository secrets**

## Workflow Features

- **Automatic deployment** on push to main branch
- **Manual deployment** via workflow_dispatch (Actions tab in GitHub)
- **Build verification** with npm ci
- **GitHub packages support** for @membership and @projectShell packages
- **Deployment package** creation with only necessary files

## Deployment Process

1. Code is checked out
2. Node.js 20.x is set up
3. npm is configured for GitHub packages
4. Dependencies are installed via `npm ci`
5. Deployment package is created
6. Azure authentication is performed
7. Node.js version is configured in Azure
8. Package is deployed to Azure App Service

## Manual Deployment

To manually trigger a deployment:

1. Go to the **Actions** tab in GitHub
2. Select **Build and deploy Node.js app to Azure Web App - reportingServiceShell**
3. Click **Run workflow**
4. Select the `main` branch
5. Click **Run workflow**

## Verifying Deployment

After deployment completes:

1. **Health Check:** https://reportingServiceShell.azurewebsites.net/health
2. **Root Endpoint:** https://reportingServiceShell.azurewebsites.net/
3. **Azure Logs:** Check Azure Portal → App Service → Log Stream

## Troubleshooting

### Deployment fails with authentication error
- Verify all three Azure secrets are correctly set in GitHub
- Ensure the service principal has permissions to deploy to the App Service

### npm install fails with package not found
- Verify GITHUB_TOKEN secret is available (automatically provided by GitHub Actions)
- Check that @membership/policy-middleware and @projectShell/rabbitmq-middleware repositories are accessible

### Node.js version mismatch
- Ensure Azure App Service is configured to use Node.js 20.x
- Check the WEBSITE_NODE_DEFAULT_VERSION setting in Azure Portal

## Next Steps

1. Create Azure App Service named `reportingServiceShell`
2. Configure Azure secrets in GitHub repository
3. Push code to `main` branch to trigger automatic deployment

