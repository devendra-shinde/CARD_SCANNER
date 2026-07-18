"""Company enrichment: scrape website meta + LinkedIn, description, industry hints."""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger("enrich")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
}


def _normalize_url(url: str) -> str:
    url = url.strip()
    if not url:
        return ""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


async def scrape_website(url: str) -> Dict[str, Any]:
    """Scrape a website for name, description, industry hints, socials."""
    url = _normalize_url(url)
    if not url:
        return {}
    out: Dict[str, Any] = {"website": url}
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True, headers=HEADERS) as cli:
            r = await cli.get(url)
            if r.status_code >= 400:
                out["error"] = f"http_{r.status_code}"
                return out
            html = r.text
    except Exception as e:
        logger.warning("scrape failed: %s", e)
        out["error"] = str(e)
        return out

    soup = BeautifulSoup(html, "lxml")
    # Meta tags
    def meta(name: str) -> Optional[str]:
        t = soup.find("meta", attrs={"name": name}) or soup.find("meta", attrs={"property": name})
        return (t.get("content") or "").strip() if t and t.get("content") else None

    title = (soup.title.text.strip() if soup.title and soup.title.text else None)
    description = meta("description") or meta("og:description")
    og_site_name = meta("og:site_name")
    og_title = meta("og:title")

    out["title"] = title
    out["description"] = description
    out["site_name"] = og_site_name or og_title or title

    # Social links from all anchor tags
    socials: Dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        low = href.lower()
        if "linkedin.com/company" in low or "linkedin.com/in/" in low:
            socials.setdefault("linkedin", href)
        elif "twitter.com/" in low or "x.com/" in low:
            socials.setdefault("twitter", href)
        elif "facebook.com/" in low:
            socials.setdefault("facebook", href)
        elif "instagram.com/" in low:
            socials.setdefault("instagram", href)
        elif "youtube.com/" in low:
            socials.setdefault("youtube", href)
    out["socials"] = socials

    # Simple industry hint using keywords in description/title
    industry_keywords = {
        "Software": ["software", "saas", "platform", "cloud", "app"],
        "Marketing": ["marketing", "advertising", "brand", "agency"],
        "Finance": ["bank", "finance", "invest", "capital", "fintech"],
        "Healthcare": ["health", "medical", "clinic", "pharma", "hospital"],
        "Education": ["school", "education", "learning", "academy", "university"],
        "Retail": ["shop", "store", "retail", "commerce"],
        "Consulting": ["consult", "advisory", "strategy"],
        "Manufacturing": ["manufactur", "industrial", "factory"],
        "Legal": ["law", "legal", "attorney"],
        "Real Estate": ["real estate", "property", "realtor"],
    }
    blob = " ".join(filter(None, [title or "", description or ""])).lower()
    industry_guess: Optional[str] = None
    for name, keys in industry_keywords.items():
        if any(k in blob for k in keys):
            industry_guess = name
            break
    out["industry_guess"] = industry_guess

    return out
