import type { Margins } from "../api/types";

// Built from the fake servers and services in tests/test_margins.py. Made-up names only.
export const margins: Margins = {
  "ok": true,
  "ready": true,
  "seeded": true,
  "totals": {
    "mrr_cents": 37500,
    "hosting_mrr_cents": 34500,
    "addon_mrr_cents": 3000,
    "mrr_report_cents": 37500,
    "server_cost_cents": 24900,
    "contribution_cents": 12600,
    "contribution_pct": 33.6,
    "overhead_cents": 2500,
    "overhead_excluded_cents": 1000,
    "infrastructure_cents": 27400,
    "blended_margin_cents": 10100,
    "blended_margin_pct": 26.9,
    "active_services": 14,
    "mapped_services": 11,
    "unmapped_services": 3,
    "unmapped_cents": 7700,
    "retire_candidate_cents": 5000
  },
  "servers": [
    {
      "id": 1,
      "slug": "POOL",
      "label": "Fake pool box",
      "vendor": "Vendor One",
      "kind": "pool",
      "status": "active",
      "location": "Nowhere",
      "notes": "",
      "components": [
        {
          "id": 1,
          "component": "server",
          "monthly_cost_cents": 3000,
          "effective": ""
        },
        {
          "id": 2,
          "component": "control-panel",
          "monthly_cost_cents": 1000,
          "effective": ""
        }
      ],
      "mappings": [
        {
          "id": 1,
          "rule_type": "whmcs_server_id",
          "rule_value": "7",
          "allocation": "by_revenue",
          "brand_scope": "BrandA",
          "note": ""
        }
      ],
      "cost_cents": 4000,
      "revenue_cents": 5800,
      "margin_cents": 1800,
      "margin_pct": 31.0,
      "services": 6,
      "paying_services": 5,
      "customers": 3,
      "paying_customers": 2,
      "brands": [
        "BrandA"
      ],
      "flags": [],
      "single_customer": null,
      "shared": true
    },
    {
      "id": 2,
      "slug": "DED",
      "label": "Fake dedicated",
      "vendor": "Vendor One",
      "kind": "dedicated",
      "status": "active",
      "location": "",
      "notes": "",
      "components": [
        {
          "id": 3,
          "component": "server",
          "monthly_cost_cents": 15000,
          "effective": ""
        }
      ],
      "mappings": [
        {
          "id": 2,
          "rule_type": "service_id",
          "rule_value": "13",
          "allocation": "direct",
          "brand_scope": "BrandA",
          "note": ""
        }
      ],
      "cost_cents": 15000,
      "revenue_cents": 22000,
      "margin_cents": 7000,
      "margin_pct": 31.8,
      "services": 2,
      "paying_services": 2,
      "customers": 1,
      "paying_customers": 1,
      "brands": [
        "BrandA"
      ],
      "flags": [],
      "single_customer": {
        "brand": "BrandA",
        "client_id": 3,
        "name": "Third Co"
      },
      "shared": false
    },
    {
      "id": 3,
      "slug": "VM",
      "label": "Fake cloud vm",
      "vendor": "Vendor Two",
      "kind": "cloud_vm",
      "status": "active",
      "location": "",
      "notes": "",
      "components": [
        {
          "id": 4,
          "component": "server",
          "monthly_cost_cents": 500,
          "effective": ""
        }
      ],
      "mappings": [
        {
          "id": 3,
          "rule_type": "domain",
          "rule_value": "special.fake-c.test",
          "allocation": "direct",
          "brand_scope": "",
          "note": ""
        }
      ],
      "cost_cents": 500,
      "revenue_cents": 1000,
      "margin_cents": 500,
      "margin_pct": 50.0,
      "services": 1,
      "paying_services": 1,
      "customers": 1,
      "paying_customers": 1,
      "brands": [
        "BrandA"
      ],
      "flags": [],
      "single_customer": {
        "brand": "BrandA",
        "client_id": 3,
        "name": "Third Co"
      },
      "shared": false
    },
    {
      "id": 4,
      "slug": "REPO",
      "label": "Fake repo box",
      "vendor": "Vendor Two",
      "kind": "dedicated",
      "status": "active",
      "location": "",
      "notes": "",
      "components": [
        {
          "id": 5,
          "component": "server",
          "monthly_cost_cents": 400,
          "effective": ""
        }
      ],
      "mappings": [
        {
          "id": 4,
          "rule_type": "brand",
          "rule_value": "BrandB",
          "allocation": "by_revenue",
          "brand_scope": "BrandB",
          "note": ""
        }
      ],
      "cost_cents": 400,
      "revenue_cents": 1000,
      "margin_cents": 600,
      "margin_pct": 60.0,
      "services": 2,
      "paying_services": 2,
      "customers": 2,
      "paying_customers": 2,
      "brands": [
        "BrandB"
      ],
      "flags": [],
      "single_customer": null,
      "shared": true
    },
    {
      "id": 5,
      "slug": "OLD",
      "label": "Fake idle box",
      "vendor": "Vendor One",
      "kind": "dedicated",
      "status": "retire_candidate",
      "location": "",
      "notes": "",
      "components": [
        {
          "id": 6,
          "component": "server",
          "monthly_cost_cents": 5000,
          "effective": ""
        }
      ],
      "mappings": [],
      "cost_cents": 5000,
      "revenue_cents": 0,
      "margin_cents": -5000,
      "margin_pct": null,
      "services": 0,
      "paying_services": 0,
      "customers": 0,
      "paying_customers": 0,
      "brands": [],
      "flags": [
        "retire_candidate",
        "zero_revenue",
        "negative_margin"
      ],
      "single_customer": null,
      "shared": false
    },
    {
      "id": 6,
      "slug": "GONE",
      "label": "Fake retired box",
      "vendor": "Vendor One",
      "kind": "dedicated",
      "status": "retired",
      "location": "",
      "notes": "",
      "components": [
        {
          "id": 7,
          "component": "server",
          "monthly_cost_cents": 3000,
          "effective": ""
        }
      ],
      "mappings": [
        {
          "id": 5,
          "rule_type": "service_id",
          "rule_value": "16",
          "allocation": "direct",
          "brand_scope": "BrandA",
          "note": ""
        }
      ],
      "cost_cents": 0,
      "revenue_cents": 0,
      "margin_cents": 0,
      "margin_pct": null,
      "services": 0,
      "paying_services": 0,
      "customers": 0,
      "paying_customers": 0,
      "brands": [],
      "flags": [
        "retired"
      ],
      "single_customer": null,
      "shared": false
    }
  ],
  "brands": [
    {
      "brand": "BrandA",
      "services": 12,
      "revenue_cents": 36500,
      "cost_cents": 19500,
      "margin_cents": 17000,
      "margin_pct": 46.6,
      "unmapped_cents": 7700
    },
    {
      "brand": "BrandB",
      "services": 2,
      "revenue_cents": 1000,
      "cost_cents": 400,
      "margin_cents": 600,
      "margin_pct": 60.0,
      "unmapped_cents": 0
    }
  ],
  "single_customers": [
    {
      "server_id": 2,
      "server": "Fake dedicated",
      "brand": "BrandA",
      "client_id": 3,
      "name": "Third Co",
      "cost_cents": 15000,
      "revenue_cents": 22000,
      "margin_cents": 7000,
      "margin_pct": 31.8
    },
    {
      "server_id": 3,
      "server": "Fake cloud vm",
      "brand": "BrandA",
      "client_id": 3,
      "name": "Third Co",
      "cost_cents": 500,
      "revenue_cents": 1000,
      "margin_cents": 500,
      "margin_pct": 50.0
    }
  ],
  "customer_rollups": [
    {
      "brand": "BrandA",
      "client_id": 3,
      "name": "Third Co",
      "services": 4,
      "revenue_cents": 23000,
      "cost_cents": 15500,
      "margin_cents": 7500,
      "margin_pct": 32.6,
      "servers": [
        "Fake cloud vm",
        "Fake dedicated",
        "Fake pool box"
      ]
    }
  ],
  "plan_groups": [
    {
      "server_id": 1,
      "server": "Fake pool box",
      "group": "VPS",
      "services": 1,
      "paying_services": 1,
      "revenue_cents": 3000,
      "cost_cents": 2069,
      "margin_cents": 931,
      "margin_pct": 31.0,
      "even_cost_cents": 667,
      "even_margin_cents": 2333
    },
    {
      "server_id": 1,
      "server": "Fake pool box",
      "group": "Shared",
      "services": 3,
      "paying_services": 2,
      "revenue_cents": 2000,
      "cost_cents": 1379,
      "margin_cents": 621,
      "margin_pct": 31.1,
      "even_cost_cents": 2000,
      "even_margin_cents": 0
    },
    {
      "server_id": 1,
      "server": "Fake pool box",
      "group": "Addons on Shared",
      "services": 2,
      "paying_services": 2,
      "revenue_cents": 800,
      "cost_cents": 552,
      "margin_cents": 248,
      "margin_pct": 31.0,
      "even_cost_cents": 1333,
      "even_margin_cents": -533
    },
    {
      "server_id": 4,
      "server": "Fake repo box",
      "group": "Repos",
      "services": 2,
      "paying_services": 2,
      "revenue_cents": 1000,
      "cost_cents": 400,
      "margin_cents": 600,
      "margin_pct": 60.0,
      "even_cost_cents": 400,
      "even_margin_cents": 600
    }
  ],
  "unmapped": {
    "groups": [
      {
        "brand": "BrandA",
        "group": "Dedicated Servers",
        "cycle": "recurring",
        "services": 1,
        "paying_services": 1,
        "revenue_cents": 7500
      },
      {
        "brand": "BrandA",
        "group": "Addons on Dedicated Servers",
        "cycle": "recurring",
        "services": 1,
        "paying_services": 1,
        "revenue_cents": 200
      },
      {
        "brand": "BrandA",
        "group": "Shared",
        "cycle": "One Time",
        "services": 1,
        "paying_services": 0,
        "revenue_cents": 0
      }
    ],
    "top": [
      {
        "brand": "BrandA",
        "kind": "hosting",
        "service_id": 16,
        "client_id": 1,
        "name": "Fake Corp A",
        "domain": "lost.fake-a.test",
        "plan": "Dedicated",
        "group": "Dedicated Servers",
        "cycle": "Monthly",
        "whmcs_server_id": null,
        "reason": "server retired",
        "revenue_cents": 7500
      },
      {
        "brand": "BrandA",
        "kind": "addon",
        "service_id": 204,
        "client_id": 1,
        "name": "Fake Corp A",
        "domain": "",
        "plan": "Addon: Backup",
        "group": "Addons on Dedicated Servers",
        "cycle": "Monthly",
        "whmcs_server_id": null,
        "reason": "server retired",
        "revenue_cents": 200
      }
    ]
  },
  "overhead": [
    {
      "id": 1,
      "label": "Licenses",
      "vendor": "Vendor Three",
      "monthly_cost_cents": 2500,
      "kind": "shared",
      "note": ""
    },
    {
      "id": 2,
      "label": "Side project",
      "vendor": "Vendor Four",
      "monthly_cost_cents": 1000,
      "kind": "not_this_business",
      "note": ""
    }
  ],
  "whatif": {
    "merge_default": [
      3,
      2
    ],
    "customers": [
      {
        "key": "BrandA:3",
        "brand": "BrandA",
        "client_id": 3,
        "name": "Third Co",
        "revenue_cents": 23000,
        "paying_services": 3,
        "by_server": {
          "2": 22000,
          "3": 1000
        }
      },
      {
        "key": "BrandA:1",
        "brand": "BrandA",
        "client_id": 1,
        "name": "Fake Corp A",
        "revenue_cents": 9500,
        "paying_services": 5,
        "by_server": {
          "1": 1800,
          "unmapped": 7700
        }
      },
      {
        "key": "BrandA:2",
        "brand": "BrandA",
        "client_id": 2,
        "name": "Pat Example",
        "revenue_cents": 4000,
        "paying_services": 2,
        "by_server": {
          "1": 4000
        }
      },
      {
        "key": "BrandB:1",
        "brand": "BrandB",
        "client_id": 1,
        "name": "Repo User",
        "revenue_cents": 800,
        "paying_services": 1,
        "by_server": {
          "4": 800
        }
      },
      {
        "key": "BrandB:2",
        "brand": "BrandB",
        "client_id": 2,
        "name": "Sam Sample",
        "revenue_cents": 200,
        "paying_services": 1,
        "by_server": {
          "4": 200
        }
      }
    ],
    "plans": [
      {
        "key": "BrandA:Dedicated",
        "brand": "BrandA",
        "plan": "Dedicated",
        "group": "Dedicated Servers",
        "revenue_cents": 27500,
        "paying_services": 2,
        "by_server": {
          "2": 20000,
          "unmapped": 7500
        }
      },
      {
        "key": "BrandA:Addon: Backup",
        "brand": "BrandA",
        "plan": "Addon: Backup",
        "group": "Addons on Shared",
        "revenue_cents": 3000,
        "paying_services": 4,
        "by_server": {
          "1": 800,
          "2": 2000,
          "unmapped": 200
        }
      },
      {
        "key": "BrandA:Starter",
        "brand": "BrandA",
        "plan": "Starter",
        "group": "Shared",
        "revenue_cents": 3000,
        "paying_services": 3,
        "by_server": {
          "1": 2000,
          "3": 1000
        }
      },
      {
        "key": "BrandA:VPS Small",
        "brand": "BrandA",
        "plan": "VPS Small",
        "group": "VPS",
        "revenue_cents": 3000,
        "paying_services": 1,
        "by_server": {
          "1": 3000
        }
      },
      {
        "key": "BrandB:Repo",
        "brand": "BrandB",
        "plan": "Repo",
        "group": "Repos",
        "revenue_cents": 1000,
        "paying_services": 2,
        "by_server": {
          "4": 1000
        }
      }
    ]
  },
  "notes": [
    "Revenue is Active WHMCS services normalized to a month (One Time and Free Account count as $0); addons follow their parent service.",
    "Server cost is shared across a server's services by revenue. Overhead is spread across all revenue and shown separately.",
    "Payment-processing fees and payroll are not deducted."
  ]
};
