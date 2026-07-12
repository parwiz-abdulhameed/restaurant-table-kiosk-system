@echo off
title KioskFlow - Restoran Kiosk Sistemi
color 0A

:start
cls
echo.
echo  ==============================================================
echo  ^|                                                            ^|
echo  ^|    _  _  _             _     _  ____  _                    ^|
echo  ^|    ^| ^|/ /^| ^|           ^| ^|   ^| ^|^|  __^|^| ^|                   ^|
echo  ^|    ^| ' / ^| ^| ___  ___ ^| ^| _ ^| ^|^| ^|__  ^| ^| ___  _ _ _       ^|
echo  ^|    ^|  ^<  ^| ^|/ _ \/ __^|^| ^|/ /^| ^|^|  __^| ^| ^|/ _ \^| ' ' _ \      ^|
echo  ^|    ^| . \ ^| ^|^| (_) \__ \^|   ^< ^| ^|^| ^|__  ^| ^|^| (_) ^|^| ^| ^| ^| ^|     ^|
echo  ^|    ^|_^|\_\^|_^|\___/^|___/^|_^|\_\^|_^|^|____^| ^|_^|\___/^|_^|_^|_^| ^|_^|     ^|
echo  ^|                                                            ^|
echo  ==============================================================
echo  ^|                                                            ^|
echo  ^|         SYSTEM  : KioskFlow Terminal Server v1.0           ^|
echo  ^|         PORT    : 3000 (Active Listening)                  ^|
echo  ^|         STATUS  : Online ^| Database Connected              ^|
echo  ^|                                                            ^|
echo  ^|------------------------------------------------------------^|
echo  ^|                                                            ^|
echo  ^|         DESIGNED BY : PARWIZ ABDUL HAMEED                  ^|
echo  ^|         EMAIL       : parwiz.abdulhameed@gmail.com        ^|
echo  ^|                                                            ^|
echo  ==============================================================
echo.
echo  [-] KioskFlow Core Engine yukleniyor...
echo  [-] Yerel ag istekleri dinleniyor...
echo.

:: Sunucu dosyalarının olduğu dizine geçiş yap
cd /d "%~dp0"

:: Tarayıcıyı tetikle
start "" "http://localhost:3000/admin"

:: Projeyi başlat
npm start

:: Eğer sunucu bir şekilde durursa terminal hemen kapanmasın diye koruma
echo.
echo  [!] Sunucu durduruldu veya bir hata olustu.
pause