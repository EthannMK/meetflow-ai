# PowerShell 1-Command GCP Cloud Run Deployment Script
param(
    [string]$ProjectId = "",
    [string]$Region = "asia-southeast1",
    [string]$ServiceName = "meetflow-ai"
)

if ($ProjectId -ne "") {
    gcloud config set project $ProjectId
}

Write-Host "Deploying $ServiceName to Google Cloud Run in $Region..." -ForegroundColor Cyan

gcloud run deploy $ServiceName `
    --source . `
    --region $Region `
    --platform managed `
    --allow-unauthenticated `
    --max-instances 3 `
    --memory 512Mi
