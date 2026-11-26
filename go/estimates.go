package main

import (
	"sort"
	"strings"
)

type Need struct {
	Material                                                                                *Material
	Required, StockAvailable, Allocated, Shortage, PurchaseQuantity, PurchaseCost, UsedCost number
	Arrival                                                                                 string
	Cuts                                                                                    []Cut
	Balance                                                                                 number
}
type Cut struct {
	Quantity string
	Count    int
}
type Plan struct {
	Order                     *Order
	Lines                     []Line
	Needs                     []Need
	Minutes                   number
	Ready, Completion, Reason string
	ToMake                    int
}

func (d *Data) orderPlan(o *Order, day string, free map[string]int) Plan {
	p := Plan{Order: o, Ready: day, Lines: append([]Line(nil), o.Lines...), Needs: []Need{}}
	counts := make([]int, len(p.Lines))
	for i := range p.Lines {
		l := &p.Lines[i]
		l.FromStock += min(l.remaining(), free[l.ProductID])
		counts[i] = l.remaining()
		p.ToMake += counts[i]
		p.Minutes = p.Minutes.Add(n(d.lineQuote(*l).Minutes).Mul(whole(counts[i])))
	}
	required := d.requirements(o, counts)
	for _, m := range d.Materials {
		quantity := required[m.ID]
		if !quantity.IsPositive() {
			continue
		}
		allocated := minimum(n(m.Stock), quantity)
		shortage := quantity.Sub(allocated)
		packs := divide(shortage, n(m.PackQuantity)).Ceil()
		arrival := day
		if shortage.IsPositive() {
			arrival = businessDays(day, d.supplier(m.SupplierID).LeadDays)
		}
		cost := whole(0)
		for i, l := range p.Lines {
			for _, r := range d.lineQuote(l).Recipe {
				if r.MaterialID == m.ID {
					cost = cost.Add(divide(n(r.Quantity).Mul(whole(counts[i])).Mul(n(r.PackPrice)), n(r.PackQuantity)))
				}
			}
		}
		p.Needs = append(p.Needs, Need{Material: d.material(m.ID), Required: quantity, StockAvailable: n(m.Stock), Allocated: allocated, Shortage: shortage, PurchaseQuantity: packs.Mul(n(m.PackQuantity)), PurchaseCost: packs.Mul(n(m.PackPrice)), Arrival: arrival, UsedCost: cost})
		if arrival > p.Ready {
			p.Ready = arrival
		}
	}
	sort.SliceStable(p.Needs, func(i, j int) bool {
		a, b := p.Needs[i], p.Needs[j]
		if a.Shortage.IsPositive() != b.Shortage.IsPositive() {
			return a.Shortage.IsPositive()
		}
		return strings.ToLower(a.Material.Name) < strings.ToLower(b.Material.Name)
	})
	return p
}
func (d *Data) schedulePlan(p *Plan, calendar map[string]number, day string) {
	if p.Minutes.IsZero() {
		p.Completion = day
		return
	}
	working := false
	for _, h := range d.Schedule.Hours {
		working = working || n(h).IsPositive()
	}
	if !working {
		p.Reason = "Set working hours to estimate completion."
		return
	}
	left := p.Minutes
	for date, count := p.Ready, 0; count < 3660; date, count = nextDay(date), count+1 {
		capacity := n(d.Schedule.Hours[weekDay(date)]).Mul(whole(60))
		for _, off := range d.Schedule.DaysOff {
			if off == date {
				capacity = whole(0)
				break
			}
		}
		take := minimum(positive(capacity.Sub(calendar[date])), left)
		calendar[date] = calendar[date].Add(take)
		left = left.Sub(take)
		if left.IsZero() {
			p.Completion = date
			return
		}
	}
	p.Reason = "Work exceeds the 10-year planning window. Review the order or working hours."
}
func (d *Data) plans(day string) map[string]Plan {
	result := map[string]Plan{}
	calendar := map[string]number{}
	free := d.freeProducts()
	for _, o := range d.activeOrders() {
		p := d.orderPlan(o, day, free)
		d.schedulePlan(&p, calendar, day)
		result[o.ID] = p
	}
	for i := range d.Orders {
		if d.Orders[i].Status == "PENDING" {
			o := &d.Orders[i]
			p := d.orderPlan(o, day, free)
			copyCalendar := map[string]number{}
			for k, v := range calendar {
				copyCalendar[k] = v
			}
			d.schedulePlan(&p, copyCalendar, day)
			result[o.ID] = p
		}
	}
	return result
}
func (d *Data) summaries() ([]Need, map[string][]Need) {
	totals := map[string]map[string]int{}
	individual := map[string][]Need{}
	free := d.freeProducts()
	orders := append([]*Order{}, d.activeOrders()...)
	pending := []*Order{}
	for i := range d.Orders {
		if d.Orders[i].Status == "PENDING" {
			pending = append(pending, &d.Orders[i])
		}
	}
	sort.SliceStable(pending, func(i, j int) bool {
		a, b := pending[i], pending[j]
		ad, bd := a.RequestedDate, b.RequestedDate
		if ad == "" {
			ad = "9999"
		}
		if bd == "" {
			bd = "9999"
		}
		if ad == bd {
			return a.CreatedDate < b.CreatedDate
		}
		return ad < bd
	})
	orders = append(orders, pending...)
	add := func(target map[string]map[string]int, id, q string, count int) {
		if target[id] == nil {
			target[id] = map[string]int{}
		}
		target[id][n(q).String()] += count
	}
	summarize := func(target map[string]map[string]int) []Need {
		result := []Need{}
		for id, cuts := range target {
			m := d.material(id)
			need := Need{Material: m, Cuts: []Cut{}}
			for q, c := range cuts {
				need.Cuts = append(need.Cuts, Cut{q, c})
				need.Required = need.Required.Add(n(q).Mul(whole(c)))
			}
			sort.Slice(need.Cuts, func(i, j int) bool { return n(need.Cuts[i].Quantity).GreaterThan(n(need.Cuts[j].Quantity)) })
			need.Balance = n(m.Stock).Sub(need.Required)
			result = append(result, need)
		}
		sort.Slice(result, func(i, j int) bool {
			return strings.ToLower(result[i].Material.Name) < strings.ToLower(result[j].Material.Name)
		})
		return result
	}
	for _, o := range orders {
		isolated := map[string]map[string]int{}
		isolatedFree := d.freeProducts()
		for _, l := range o.Lines {
			remaining := l.remaining()
			count := remaining - min(remaining, free[l.ProductID])
			free[l.ProductID] -= remaining - count
			isolatedCount := remaining - min(remaining, isolatedFree[l.ProductID])
			for _, r := range d.lineQuote(l).Recipe {
				if count > 0 {
					add(totals, r.MaterialID, r.Quantity, count)
				}
				if isolatedCount > 0 {
					add(isolated, r.MaterialID, r.Quantity, isolatedCount)
				}
			}
		}
		individual[o.ID] = summarize(isolated)
	}
	return summarize(totals), individual
}
