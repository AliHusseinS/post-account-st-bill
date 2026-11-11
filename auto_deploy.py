#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
auto_deploy.py — النشر التلقائي الشامل
يرفع التعديلات تلقائياً إلى:
  1. مستودع GitHub: https://github.com/AliHusseinS/post-account-st-bill
  2. Google Apps Script المرتبط بـ Google Sheet:
     https://docs.google.com/spreadsheets/d/1U6qpwnVtTDf-K7OpwNWtI-seN7bN2GaDwfYT2m2SL60
"""

import sys
import os
import json
import urllib.request
import urllib.parse
import subprocess
from datetime import datetime

# Configure stdout for utf-8
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPT_ID = "1ooII-qFGrwFU9BJwhKrxI3_3XjuAlwSlZHZzOAiXZE61CP9aYKsaO7zq"
DEPLOYMENT_ID = "AKfycbwCAmMVLdSUBe4cIu3nFOI7-DpsK9j_33RZ8edHilBnqyYiknlo7k7fWIc46AA5ASOd"
WEBAPP_URL = f"https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec"

def get_oauth_token():
    clasprc_path = os.path.expanduser("~/.clasprc.json")
    if not os.path.exists(clasprc_path):
        raise FileNotFoundError(f"Missing {clasprc_path}")
    
    with open(clasprc_path, 'r', encoding='utf-8') as f:
        rc = json.load(f)
    
    client_id = rc['oauth2ClientSettings']['clientId']
    client_secret = rc['oauth2ClientSettings']['clientSecret']
    refresh_token = rc['token']['refresh_token']
    
    data = urllib.parse.urlencode({
        'client_id': client_id,
        'client_secret': client_secret,
        'refresh_token': refresh_token,
        'grant_type': 'refresh_token'
    }).encode('utf-8')
    
    req = urllib.request.Request(
        'https://oauth2.googleapis.com/token',
        data=data,
        headers={'Content-Type': 'application/x-www-form-urlencoded'}
    )
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode('utf-8'))
        return res['access_token']

def deploy_to_github(commit_msg):
    print("\n[1/4] 🚀 جاري الرفع إلى GitHub...")
    subprocess.run(["git", "add", "-A"], cwd=PROJECT_DIR, check=True)
    status = subprocess.run(["git", "status", "--porcelain"], cwd=PROJECT_DIR, capture_output=True, text=True).stdout.strip()
    if status:
        subprocess.run(["git", "commit", "-m", commit_msg], cwd=PROJECT_DIR, check=True)
        push_res = subprocess.run(["git", "push", "origin", "main"], cwd=PROJECT_DIR, capture_output=True, text=True)
        if push_res.returncode != 0:
            print("Git push error:", push_res.stderr)
            raise RuntimeError("Git push failed")
        print("      ✅ تم الرفع على GitHub بنجاح.")
    else:
        print("      ℹ️ لا توجد تعديلات جديدة لرفعها على GitHub.")

def deploy_to_apps_script(token):
    print("\n[2/4] 📤 جاري رفع كود Google Apps Script إلى المشروع المرتبط بالـ Sheet...")
    gas_path = os.path.join(PROJECT_DIR, "GoogleAppsScript.js")
    with open(gas_path, 'r', encoding='utf-8') as f:
        gas_code = f.read()
    
    manifest = {
        "timeZone": "Asia/Baghdad",
        "dependencies": {},
        "exceptionLogging": "STACKDRIVER",
        "runtimeVersion": "V8",
        "webapp": {
            "executeAs": "USER_DEPLOYING",
            "access": "ANYONE_ANONYMOUS"
        }
    }
    
    payload = {
        "files": [
            {
                "name": "appsscript",
                "type": "JSON",
                "source": json.dumps(manifest, indent=2)
            },
            {
                "name": "Code",
                "type": "SERVER_JS",
                "source": gas_code
            }
        ]
    }
    
    # Update script content
    req = urllib.request.Request(
        f"https://script.googleapis.com/v1/projects/{SCRIPT_ID}/content",
        data=json.dumps(payload).encode('utf-8'),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        method="PUT"
    )
    with urllib.request.urlopen(req) as resp:
        print("      ✅ تم تحديث كود المشروع في Apps Script.")
    
    # Create new version
    print("\n[3/4] 📦 إنشاء نسخة جديدة ونشرها (Deployment Update)...")
    ver_payload = {
        "description": f"auto deploy {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    }
    req_ver = urllib.request.Request(
        f"https://script.googleapis.com/v1/projects/{SCRIPT_ID}/versions",
        data=json.dumps(ver_payload).encode('utf-8'),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        method="POST"
    )
    with urllib.request.urlopen(req_ver) as resp:
        ver_res = json.loads(resp.read().decode('utf-8'))
        version_num = ver_res['versionNumber']
        print(f"      ✅ تم إنشاء الإصدار رقم: {version_num}")
    
    # Update active deployment
    dep_payload = {
        "deploymentConfig": {
            "scriptId": SCRIPT_ID,
            "versionNumber": version_num,
            "manifestFileName": "appsscript",
            "description": f"v{version_num}"
        }
    }
    req_dep = urllib.request.Request(
        f"https://script.googleapis.com/v1/projects/{SCRIPT_ID}/deployments/{DEPLOYMENT_ID}",
        data=json.dumps(dep_payload).encode('utf-8'),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        method="PUT"
    )
    with urllib.request.urlopen(req_dep) as resp:
        print(f"      ✅ تم تحديث النشر {DEPLOYMENT_ID} ليشير إلى الإصدار {version_num}.")

def trigger_sync():
    print("\n[4/4] 🔄 التحقق من تشغيل السكريبت وتحديث الـ Google Sheet تلقائياً...")
    try:
        req = urllib.request.Request(WEBAPP_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            count = len(data) if isinstance(data, list) else 0
            print(f"      ✅ تم الاتصال بنجاح بالـ Web App. عدد الطلبة المحمّلين: {count}")
    except Exception as e:
        print(f"      ⚠️ ملاحظة أثناء فحص الـ Web App: {e}")

def main():
    msg = sys.argv[1] if len(sys.argv) > 1 else f"auto deploy {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    print("=" * 60)
    print("  🚀 نظام النشر الآلي المباشر (GitHub + Google Sheets/Apps Script)")
    print("=" * 60)
    
    token = get_oauth_token()
    deploy_to_apps_script(token)
    deploy_to_github(msg)
    trigger_sync()
    
    print("\n" + "=" * 60)
    print("  🎉 اكتمل النشر بالكامل!")
    print(f"  🌐 الموقع المباشر:  https://aliusseins.github.io/post-account-st-bill")
    print(f"  📊 جدول البيانات:  https://docs.google.com/spreadsheets/d/1U6qpwnVtTDf-K7OpwNWtI-seN7bN2GaDwfYT2m2SL60")
    print(f"  ⚡ واجهة Apps Script: {WEBAPP_URL}")
    print("=" * 60)

if __name__ == '__main__':
    main()
