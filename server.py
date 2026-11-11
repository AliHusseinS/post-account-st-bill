#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
خادم محلي لتشغيل نظام متابعة وتسديد طلبة الدراسات العليا
Local HTTP Server for Postgraduate Tuition & Auditing System
"""

import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def run():
    os.chdir(DIRECTORY)
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}/index.html"
        print("=" * 60)
        print("  تم تشغيل نظام إدارة طلبة الدراسات العليا بنجاح!")
        print(f"  الرابط في المتصفح: {url}")
        print("=" * 60)
        print("  بيانات تسجيل الدخول الافتراضية:")
        print("   1) قسم الدراسات العليا: postgrad / 123")
        print("   2) قسم الحسابات:       accounts / 123")
        print("=" * 60)
        print("  اضغط Ctrl+C لإيقاف الخادم.")
        
        try:
            webbrowser.open(url)
        except Exception:
            pass

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nتم إيقاف الخادم.")
            sys.exit(0)

if __name__ == "__main__":
    run()
