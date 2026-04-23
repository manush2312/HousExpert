package utils

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

var presignClient *s3.PresignClient
var bucketName string
var publicBase string

// InitStorage sets up the S3/R2 client from environment variables.
// This is intentionally non-fatal — the app starts fine without storage
// configured; only the presigned URL endpoints will return 503.
//
// Required env vars:
//
//	S3_BUCKET      — bucket name
//	S3_ACCESS_KEY  — access key ID
//	S3_SECRET_KEY  — secret access key
//
// Optional:
//
//	S3_REGION      — AWS region (default: "auto", works for R2)
//	S3_ENDPOINT    — custom endpoint for R2: https://<account_id>.r2.cloudflarestorage.com
//	S3_PUBLIC_BASE — public CDN base URL, e.g. https://cdn.housexpert.in
func InitStorage() error {
	bucketName = os.Getenv("S3_BUCKET")
	accessKey := os.Getenv("S3_ACCESS_KEY")
	secretKey := os.Getenv("S3_SECRET_KEY")
	publicBase = os.Getenv("S3_PUBLIC_BASE")

	region := os.Getenv("S3_REGION")
	if region == "" {
		region = "auto"
	}

	if bucketName == "" || accessKey == "" || secretKey == "" {
		return fmt.Errorf("S3_BUCKET, S3_ACCESS_KEY, and S3_SECRET_KEY must be set")
	}

	cfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion(region),
		config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
		),
	)
	if err != nil {
		return fmt.Errorf("failed to load storage config: %w", err)
	}

	endpoint := os.Getenv("S3_ENDPOINT")
	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		if endpoint != "" {
			// Required for Cloudflare R2 and other S3-compatible stores
			o.BaseEndpoint = aws.String(endpoint)
			o.UsePathStyle = true
		}
	})

	presignClient = s3.NewPresignClient(client)
	return nil
}

// StorageReady reports whether storage has been initialized.
func StorageReady() bool {
	return presignClient != nil
}

// PresignUpload returns a presigned HTTP PUT URL the frontend can use
// to upload a file directly to S3/R2 without routing through the backend.
// The URL expires after expiryMinutes minutes.
func PresignUpload(key, contentType string, expiryMinutes int) (string, error) {
	if presignClient == nil {
		return "", fmt.Errorf("storage not initialized")
	}

	req, err := presignClient.PresignPutObject(context.Background(), &s3.PutObjectInput{
		Bucket:      aws.String(bucketName),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}, s3.WithPresignExpires(time.Duration(expiryMinutes)*time.Minute))
	if err != nil {
		return "", fmt.Errorf("failed to presign upload: %w", err)
	}

	return req.URL, nil
}

// PublicURL returns the public URL for a stored file.
// Uses S3_PUBLIC_BASE if set (CDN), otherwise falls back to default S3 URL.
func PublicURL(key string) string {
	if publicBase != "" {
		return fmt.Sprintf("%s/%s", publicBase, key)
	}
	return fmt.Sprintf("https://%s.s3.amazonaws.com/%s", bucketName, key)
}


