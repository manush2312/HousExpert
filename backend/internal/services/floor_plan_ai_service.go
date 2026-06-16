package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const defaultFloorPlanModel = "gpt-5.5"

var ErrOpenAINotConfigured = errors.New("openai api key is not configured")

type DetectedFloorPlanRoom struct {
	Type       string  `json:"type"`
	Label      string  `json:"label"`
	Confidence float64 `json:"confidence"`
}

type FloorPlanAIAnalysis struct {
	Rooms    []DetectedFloorPlanRoom `json:"rooms"`
	Warnings []string                `json:"warnings"`
}

type openAIErrorResponse struct {
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code"`
	} `json:"error"`
}

// AnalyzeFloorPlanRooms asks OpenAI vision to extract room labels/areas from a
// validated floor-plan image. PDFs must be converted to an image before calling.
func AnalyzeFloorPlanRooms(ctx context.Context, imageBytes []byte, contentType string) (*FloorPlanAIAnalysis, error) {
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		return nil, ErrOpenAINotConfigured
	}
	if len(imageBytes) == 0 {
		return nil, fmt.Errorf("floor plan image is empty")
	}

	model := strings.TrimSpace(os.Getenv("OPENAI_FLOOR_PLAN_MODEL"))
	if model == "" {
		model = defaultFloorPlanModel
	}

	payload := buildFloorPlanAnalysisRequest(model, imageBytes, contentType)
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to prepare floor plan analysis request: %w", err)
	}

	requestCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(requestCtx, http.MethodPost, "https://api.openai.com/v1/responses", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to prepare OpenAI request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("OpenAI floor plan analysis failed: %w", err)
	}
	defer resp.Body.Close()

	responseBytes, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, fmt.Errorf("failed to read OpenAI response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("OpenAI floor plan analysis failed: %s", parseOpenAIError(responseBytes, resp.Status))
	}

	outputText, err := extractOpenAIOutputText(responseBytes)
	if err != nil {
		return nil, err
	}

	var analysis FloorPlanAIAnalysis
	if err := json.Unmarshal([]byte(outputText), &analysis); err != nil {
		return nil, fmt.Errorf("OpenAI returned an invalid room analysis payload: %w", err)
	}
	analysis.Rooms = normalizeDetectedRooms(analysis.Rooms)
	if analysis.Warnings == nil {
		analysis.Warnings = []string{}
	}
	return &analysis, nil
}

func buildFloorPlanAnalysisRequest(model string, imageBytes []byte, contentType string) map[string]any {
	if strings.TrimSpace(contentType) == "" {
		contentType = "image/png"
	}

	return map[string]any{
		"model": model,
		"input": []any{
			map[string]any{
				"role":    "system",
				"content": "You extract room and area labels from residential floor plans for interior quotation drafting. Return only visible rooms or areas. Do not invent rooms. Use warnings for unclear text, cropped plans, low-quality images, or ambiguous areas.",
			},
			map[string]any{
				"role": "user",
				"content": []any{
					map[string]any{
						"type": "input_text",
						"text": "Analyze this floor plan and identify rooms/areas such as bedrooms, hall/living, kitchen, bathrooms, balconies, utility, dining, pooja, study, and passages. Use the exact visible label when possible. Confidence must be between 0 and 1.",
					},
					map[string]any{
						"type":      "input_image",
						"image_url": "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(imageBytes),
					},
				},
			},
		},
		"max_output_tokens": 1200,
		"text": map[string]any{
			"format": map[string]any{
				"type":   "json_schema",
				"name":   "floor_plan_room_detection",
				"strict": true,
				"schema": floorPlanRoomDetectionSchema(),
			},
		},
	}
}

func floorPlanRoomDetectionSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"rooms": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"properties": map[string]any{
						"type": map[string]any{
							"type": "string",
							"enum": []string{
								"bedroom",
								"hall",
								"living",
								"kitchen",
								"bathroom",
								"balcony",
								"utility",
								"dining",
								"pooja",
								"study",
								"passage",
								"other",
							},
						},
						"label": map[string]any{
							"type": "string",
						},
						"confidence": map[string]any{
							"type":    "number",
							"minimum": 0,
							"maximum": 1,
						},
					},
					"required": []string{"type", "label", "confidence"},
				},
			},
			"warnings": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "string",
				},
			},
		},
		"required": []string{"rooms", "warnings"},
	}
}

func extractOpenAIOutputText(responseBytes []byte) (string, error) {
	var response struct {
		OutputText string `json:"output_text"`
		Output     []struct {
			Type    string `json:"type"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	if err := json.Unmarshal(responseBytes, &response); err != nil {
		return "", fmt.Errorf("failed to parse OpenAI response: %w", err)
	}

	if text := strings.TrimSpace(response.OutputText); text != "" {
		return text, nil
	}

	for _, item := range response.Output {
		if item.Type != "" && item.Type != "message" {
			continue
		}
		for _, content := range item.Content {
			if content.Type != "" && content.Type != "output_text" && content.Type != "text" {
				continue
			}
			if text := strings.TrimSpace(content.Text); text != "" {
				return text, nil
			}
		}
	}

	return "", fmt.Errorf("OpenAI did not return floor plan analysis text")
}

func normalizeDetectedRooms(rooms []DetectedFloorPlanRoom) []DetectedFloorPlanRoom {
	if rooms == nil {
		return []DetectedFloorPlanRoom{}
	}

	normalized := make([]DetectedFloorPlanRoom, 0, len(rooms))
	for _, room := range rooms {
		room.Type = strings.TrimSpace(strings.ToLower(room.Type))
		room.Label = strings.TrimSpace(room.Label)
		if room.Type == "" {
			room.Type = "other"
		}
		if room.Label == "" {
			room.Label = room.Type
		}
		if room.Confidence < 0 {
			room.Confidence = 0
		}
		if room.Confidence > 1 {
			room.Confidence = 1
		}
		normalized = append(normalized, room)
	}
	return normalized
}

func parseOpenAIError(responseBytes []byte, fallback string) string {
	var response openAIErrorResponse
	if err := json.Unmarshal(responseBytes, &response); err == nil && response.Error != nil {
		if message := strings.TrimSpace(response.Error.Message); message != "" {
			return message
		}
	}
	return fallback
}
