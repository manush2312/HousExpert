package middleware

import (
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"housexpert/backend/internal/utils"
)

// loginLimiter is a small in-memory sliding-window limiter keyed by client IP.
// It's intentionally simple — for a single-instance deployment it's plenty to
// blunt brute-force attacks. For a multi-instance setup this would move to Redis.
type loginLimiter struct {
	mu       sync.Mutex
	hits     map[string][]time.Time
	max      int           // max attempts allowed within the window
	window   time.Duration // sliding window length
}

func newLoginLimiter(max int, window time.Duration) *loginLimiter {
	return &loginLimiter{
		hits:   make(map[string][]time.Time),
		max:    max,
		window: window,
	}
}

// allow records an attempt for key and reports whether it's within the limit.
func (l *loginLimiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	cutoff := now.Add(-l.window)
	recent := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}

	if len(recent) >= l.max {
		l.hits[key] = recent
		return false
	}

	l.hits[key] = append(recent, now)
	return true
}

// RateLimitLogins limits login attempts to `max` per `window` per client IP.
// Apply it only to the login route. Returns 429 when the limit is exceeded.
func RateLimitLogins(max int, window time.Duration) gin.HandlerFunc {
	limiter := newLoginLimiter(max, window)
	return func(c *gin.Context) {
		if !limiter.allow(c.ClientIP(), time.Now()) {
			utils.TooManyRequests(c, "too many login attempts — please wait a minute and try again")
			c.Abort()
			return
		}
		c.Next()
	}
}
