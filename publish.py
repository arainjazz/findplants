#!/usr/bin/env python3
import os
import re
import sys
import uuid
import time
import argparse
import mimetypes
import json
import urllib.request
import urllib.parse
from datetime import datetime

# Default configuration from user information
DEFAULT_EMAIL = "arainjazz@gmail.com"
DEFAULT_PASSWORD = "zhou19869021"

# Regex patterns matching TypeScript source
LOCAL_REF_RE = re.compile(
    r'(?:src|href)\s*=\s*["\']([^"\'#?][^"\']*)["\']|srcset\s*=\s*["\']([^"\']+)["\']|url\(\s*["\']?([^"\')]+)["\']?\s*\)',
    re.IGNORECASE
)

def is_external_ref(v):
    return bool(re.match(r'^(https?:|data:|blob:|//|#|mailto:|cid:)', v, re.IGNORECASE))

def is_likely_image_asset_ref(v):
    clean = v.split('?')[0].split('#')[0]
    # Handle simple unquoting / decoding
    try:
        clean = urllib.parse.unquote(clean)
    except Exception:
        pass
    return bool(re.search(r'\.(png|jpe?g|webp|gif|svg|avif|bmp|tiff?|ico)$', clean, re.IGNORECASE))

def split_srcset(v):
    candidates = []
    for part in v.split(','):
        part = part.strip()
        if not part:
            continue
        sp = part.split()
        if sp:
            candidates.append(sp[0])
    return candidates

def find_local_asset_refs(html_content):
    refs = set()
    for m in LOCAL_REF_RE.finditer(html_content):
        candidates = []
        if m.group(1):
            candidates.append(m.group(1))
        if m.group(2):
            candidates.extend(split_srcset(m.group(2)))
        if m.group(3):
            candidates.append(m.group(3))
        
        for raw in candidates:
            v = raw.strip()
            if not v or is_external_ref(v):
                continue
            if v.startswith('#') or v.startswith('?'):
                continue
            if not is_likely_image_asset_ref(v):
                continue
            refs.add(v)
    return list(refs)

def parse_env_file(filepath):
    env = {}
    if not os.path.exists(filepath):
        return env
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                key, val = line.split('=', 1)
                # Strip quotes
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                env[key] = val
    return env

def make_request(url, data=None, headers=None, method='GET'):
    if headers is None:
        headers = {}
    
    # URL encoded or JSON payload
    req_data = None
    if data is not None:
        if isinstance(data, (dict, list)):
            req_data = json.dumps(data).encode('utf-8')
            if 'Content-Type' not in headers:
                headers['Content-Type'] = 'application/json'
        elif isinstance(data, bytes):
            req_data = data
        else:
            req_data = str(data).encode('utf-8')
            
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read()
            if response.status >= 200 and response.status < 300:
                try:
                    return json.loads(res_body.decode('utf-8')), None
                except Exception:
                    return res_body.decode('utf-8'), None
            return None, f"HTTP Error: {response.status}"
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode('utf-8')
            # Try to parse JSON error message from Supabase
            err_json = json.loads(err_body)
            err_msg = err_json.get('message') or err_json.get('error_description') or err_body
        except Exception:
            err_msg = str(e)
        return None, err_msg
    except Exception as e:
        return None, str(e)

def slugify(title):
    # Basic slugification for English and Chinese characters
    # Remove special characters, replace spaces with dashes, lowercase
    s = title.lower().strip()
    s = re.sub(r'[\s_]+', '-', s)
    s = re.sub(r'[^\w\-\u4e00-\u9fff]', '', s)
    s = re.sub(r'-+', '-', s)
    return s.strip('-')

def main():
    parser = argparse.ArgumentParser(description="AI 植物百科 HTML 一键发布命令行工具")
    parser.add_argument("--html", required=True, help="要发布的 HTML 文件路径")
    parser.add_argument("--title", help="条目标题（若不指定，将由 AI 从 HTML 自动识别）")
    parser.add_argument("--slug", help="条目 URL 路径（若不指定，将自动生成）")
    parser.add_argument("--email", help="管理邮箱 (默认读取 .env 中 PUBLISH_EMAIL 或使用 arainjazz@gmail.com)")
    parser.add_argument("--password", help="密码 (默认读取 .env 中 PUBLISH_PASSWORD 或使用 zhou19869021)")
    parser.add_argument("-y", "--yes", action="store_true", help="跳过确认步骤，直接发布")
    
    args = parser.parse_args()
    
    # 1. Load config from .env
    env = parse_env_file(".env")
    supabase_url = env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL")
    supabase_key = env.get("SUPABASE_PUBLISHABLE_KEY") or env.get("VITE_SUPABASE_PUBLISHABLE_KEY")
    
    if not supabase_url or not supabase_key:
        print("❌ 错误: 无法在当前目录的 .env 文件中找到 SUPABASE_URL 或 SUPABASE_PUBLISHABLE_KEY")
        sys.exit(1)
        
    email = args.email or env.get("PUBLISH_EMAIL") or DEFAULT_EMAIL
    password = args.password or env.get("PUBLISH_PASSWORD") or DEFAULT_PASSWORD
    
    html_path = os.path.abspath(args.html)
    if not os.path.exists(html_path):
        print(f"❌ 错误: HTML 文件不存在: {html_path}")
        sys.exit(1)
        
    html_dir = os.path.dirname(html_path)
    
    print("--------------------------------------------------")
    print("🌱 AI 植物百科 - HTML 命令行自动发布工具")
    print(f"📄 目标 HTML: {html_path}")
    print("--------------------------------------------------")
    
    # 2. Authenticate
    print("🔑 正在登录管理账号...")
    login_url = f"{supabase_url}/auth/v1/token?grant_type=password"
    login_data = {"email": email, "password": password}
    headers = {"apikey": supabase_key}
    
    auth_res, err = make_request(login_url, data=login_data, headers=headers, method="POST")
    if err:
        print(f"❌ 登录失败: {err}")
        sys.exit(1)
        
    access_token = auth_res.get("access_token")
    user = auth_res.get("user", {})
    user_id = user.get("id")
    editor_name = user.get("user_metadata", {}).get("full_name") or user.get("email") or "命令行发布脚本"
    
    if not access_token or not user_id:
        print("❌ 无法获取有效的 Auth Token 或 User ID")
        sys.exit(1)
        
    print(f"🟢 登录成功! 编辑者: {editor_name}")
    
    # 3. Read HTML and scan for local images
    with open(html_path, "r", encoding="utf-8") as f:
        html_content = f.read()
        
    local_refs = find_local_asset_refs(html_content)
    
    # 4. Upload local images
    url_map = {}
    if local_refs:
        print(f"📸 扫描到 HTML 中引用了 {len(local_refs)} 个本地配图。开始上传...")
        for ref in local_refs:
            # Resolve physical path
            # Remove leading slash or dot-slashes for relative resolution
            cleaned_ref = ref.replace('\\', '/').lstrip('./').lstrip('/')
            img_path = os.path.join(html_dir, cleaned_ref)
            
            # Fallback to simple filename search if exact path not found
            if not os.path.exists(img_path):
                filename = os.path.basename(cleaned_ref)
                img_path = os.path.join(html_dir, filename)
                
            if not os.path.exists(img_path):
                print(f"⚠️ 警告: 找不到配图文件 {ref} (尝试了 {img_path})，跳过该图上传。")
                continue
                
            # Upload image
            ext = img_path.split('.')[-1] if '.' in img_path else 'bin'
            mime_type, _ = mimetypes.guess_type(img_path)
            
            # Build unique upload path (prefix with user_id to bypass RLS)
            rand_id = uuid.uuid4().hex[:8]
            timestamp = int(time.time() * 1000)
            storage_path = f"{user_id}/batch-img/{timestamp}-{rand_id}.{ext}"
            
            upload_url = f"{supabase_url}/storage/v1/object/plant-images/{storage_path}"
            
            with open(img_path, "rb") as img_file:
                img_bytes = img_file.read()
                
            print(f"   ⬆️ 正在上传: {ref} -> plant-images/{storage_path}")
            
            upload_headers = {
                "apikey": supabase_key,
                "Authorization": f"Bearer {access_token}",
                "Content-Type": mime_type or "application/octet-stream"
            }
            
            _, upload_err = make_request(upload_url, data=img_bytes, headers=upload_headers, method="POST")
            if upload_err:
                print(f"   ❌ 上传图片失败 {ref}: {upload_err}")
                sys.exit(1)
                
            # Construct public URL
            public_url = f"{supabase_url}/storage/v1/object/public/plant-images/{storage_path}"
            url_map[ref] = public_url
            
        # Rewrite image paths in HTML
        # Sort by length descending to prevent substring collisions (e.g. leaf.jpg inside big_leaf.jpg)
        sorted_refs = sorted(url_map.keys(), key=len, reverse=True)
        for ref in sorted_refs:
            html_content = html_content.replace(ref, url_map[ref])
            
        print("✅ HTML 内的本地图片路径已成功改写为云端高速 CDN 链接！")
        
    # 5. Upload final HTML file
    print("⬆️ 正在上传 HTML 正文文件...")
    rand_id = uuid.uuid4().hex[:8]
    timestamp = int(time.time() * 1000)
    html_storage_path = f"{user_id}/batch/{timestamp}-{rand_id}.html"
    html_upload_url = f"{supabase_url}/storage/v1/object/plant-html/{html_storage_path}"
    
    upload_headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "text/html; charset=utf-8"
    }
    
    _, upload_err = make_request(html_upload_url, data=html_content.encode('utf-8'), headers=upload_headers, method="POST")
    if upload_err:
        print(f"❌ 上传 HTML 失败: {upload_err}")
        sys.exit(1)
        
    public_html_url = f"{supabase_url}/storage/v1/object/public/plant-html/{html_storage_path}"
    print(f"✅ HTML 上传成功! URL: {public_html_url}")
    
    # 6. Invoke AI meta extraction Edge Function
    print("🤖 正在调用 AI 识别并自动填充字段...")
    func_url = f"{supabase_url}/functions/v1/extract-plant-meta"
    func_headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {access_token}"
    }
    func_data = {"htmlUrl": public_html_url}
    
    meta, func_err = make_request(func_url, data=func_data, headers=func_headers, method="POST")
    if func_err:
        print(f"⚠️ AI 识别出错 (将使用默认/手动属性): {func_err}")
        meta = {}
        
    # Prepare properties
    ai_title = meta.get("title") or os.path.basename(html_path).replace(".html", "").replace(".htm", "")
    title = args.title or ai_title
    
    ai_slug = meta.get("slug") or meta.get("scientific_name")
    slug = args.slug or (slugify(ai_slug) if ai_slug else slugify(title))
    if not slug:
        slug = f"p-{int(time.time())}"
        
    scientific_name = meta.get("scientific_name") or None
    common_name_en = meta.get("common_name_en") or None
    family = meta.get("family") or None
    genus = meta.get("genus") or None
    habitat = meta.get("habitat") or None
    summary = meta.get("summary") or None
    iucn_status = meta.get("iucn_status") or None
    tags = meta.get("tags") or []
    
    # Determine cover image URL (use first image in HTML if possible)
    cover_url = None
    first_img_match = re.search(r'<img\s+[^>]*src=["\']([^"\']+)["\']', html_content, re.IGNORECASE)
    if first_img_match:
        cover_url = first_img_match.group(1)
        
    print("\n---------------- AI 提取的条目信息 ----------------")
    print(f"📌 标题 (Title): {title}")
    print(f"🔗 Slug (路径): {slug}")
    print(f"🔬 学名 (Scientific): {scientific_name}")
    print(f"📖 英文俗名: {common_name_en}")
    print(f"📂 科属 (Family/Genus): {family} / {genus}")
    print(f"🌍 栖息地/入侵: {habitat}")
    print(f"🏷️ 标签 (Tags): {', '.join(tags)}")
    print(f"🔴 IUCN 评级: {iucn_status}")
    print(f"📝 摘要 (Summary): {summary}")
    print(f"🖼️ 封面图 (Cover): {cover_url}")
    print("--------------------------------------------------\n")
    
    if not args.yes:
        confirm = input("❓ 是否确认发布此条目到数据库？(Y/n): ").strip().lower()
        if confirm not in ('', 'y', 'yes'):
            print("🛑 已取消发布。")
            sys.exit(0)
            
    # 7. Check if slug exists in DB
    print("🔍 正在检查数据库中是否已存在相同 Slug...")
    check_url = f"{supabase_url}/rest/v1/plants?slug=eq.{slug}"
    check_headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {access_token}"
    }
    
    existing, check_err = make_request(check_url, headers=check_headers, method="GET")
    if check_err:
        print(f"❌ 检查重复失败: {check_err}")
        sys.exit(1)
        
    payload = {
        "title": title,
        "slug": slug,
        "scientific_name": scientific_name,
        "common_name_en": common_name_en,
        "family": family,
        "genus": genus,
        "iucn_status": iucn_status,
        "habitat": habitat,
        "summary": summary,
        "cover_url": cover_url,
        "content_type": "html",
        "rich_content": None,
        "html_url": public_html_url,
        "tags": tags,
        "author_id": user_id,
        "is_featured": False
    }
    
    is_update = bool(existing)
    plant_id = None
    
    if is_update:
        # Update existing
        plant_id = existing[0]["id"]
        print(f"📝 发现已存在条目「{existing[0]['title']}」(ID: {plant_id})，正在执行更新...")
        update_url = f"{supabase_url}/rest/v1/plants?id=eq.{plant_id}"
        # Set return=representation header to get the updated row
        update_headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {access_token}",
            "Prefer": "return=representation"
        }
        res, update_err = make_request(update_url, data=payload, headers=update_headers, method="PATCH")
        if update_err:
            print(f"❌ 更新条目失败: {update_err}")
            sys.exit(1)
    else:
        # Insert new
        print("✨ 正在插入新条目...")
        insert_url = f"{supabase_url}/rest/v1/plants"
        insert_headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {access_token}",
            "Prefer": "return=representation"
        }
        res, insert_err = make_request(insert_url, data=payload, headers=insert_headers, method="POST")
        if insert_err:
            print(f"❌ 新建条目失败: {insert_err}")
            sys.exit(1)
        if res:
            plant_id = res[0]["id"]
            
    if not plant_id:
        print("❌ 无法获取新建或更新条目的 ID")
        sys.exit(1)
        
    # 8. Record audit log in plant_edits
    print("📝 正在记录审计日志...")
    log_url = f"{supabase_url}/rest/v1/plant_edits"
    log_headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {access_token}"
    }
    log_payload = {
        "plant_id": plant_id,
        "editor_id": user_id,
        "editor_name": editor_name,
        "kind": "html_save" if is_update else "create",
        "marker_n": 0,
        "source": "publish_script",
        "summary": f"{editor_name} 使用 publish.py 命令行脚本{'更新' if is_update else '创建'}了条目「{title}」（HTML）"
    }
    _, log_err = make_request(log_url, data=log_payload, headers=log_headers, method="POST")
    if log_err:
        print(f"⚠️ 记录审计日志失败 (不影响发布): {log_err}")
        
    print("\n🎉 恭喜! 发布成功!")
    print(f"🔑 ID: {plant_id}")
    print(f"🔗 访问路径: {supabase_url.replace('.supabase.co', '.supabase.co')} /plants/{slug}")
    print("--------------------------------------------------")

if __name__ == "__main__":
    main()
