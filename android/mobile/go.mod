module smerp/android/mobile

go 1.26.0

require smerp v0.0.0

require (
	github.com/shopspring/decimal v1.6.0 // indirect
	golang.org/x/mobile v0.0.0-20261117202452-47699113848a // indirect
	golang.org/x/mod v0.43.0 // indirect
	golang.org/x/sync v0.25.0 // indirect
	golang.org/x/tools v0.53.0 // indirect
)

replace smerp => ../..

tool (
	golang.org/x/mobile/cmd/gobind
	golang.org/x/mobile/cmd/gomobile
)
