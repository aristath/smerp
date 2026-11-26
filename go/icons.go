package main

import "html/template"

var icons = map[string]string{
	"overview":  "<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/>",
	"orders":    "<rect x=\"5\" y=\"4\" width=\"14\" height=\"17\" rx=\"2\"/><path d=\"M9 4V2h6v2M9 10h6M9 14h6M9 18h4\"/>",
	"materials": "<path d=\"m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9M7 6l9 5\"/>",
	"suppliers": "<path d=\"M3 20h18M5 20V8l7-5 7 5v12M9 20v-5h6v5M9 9h1M14 9h1\"/>",
	"products":  "<path d=\"M3 9h18v7H3zM15 6h5v13h-5zM6 12.5h1M10 12.5h1\"/>",
	"inventory": "<path d=\"M3 5h18M3 12h18M3 20h18M5 5v15M19 5v15M8 8h4v4H8zM13 15h3v5h-3z\"/>",
	"schedule":  "<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M7 2v6M17 2v6M3 11h18M7 15h2M13 15h3\"/>",
	"settings":  "<path d=\"M4 7h16M4 17h16\"/><circle cx=\"9\" cy=\"7\" r=\"3\"/><circle cx=\"15\" cy=\"17\" r=\"3\"/>",
	"sun":       "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5\"/>",
	"moon":      "<path d=\"M20.5 13.3A8.5 8.5 0 0 1 10.7 3.5a8.5 8.5 0 1 0 9.8 9.8Z\"/>",
	"plus":      "<path d=\"M12 5v14M5 12h14\"/>",
}

func icon(name string) template.HTML {
	return template.HTML(`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">` + icons[name] + `</svg>`)
}
