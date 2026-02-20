<?php
/**
 * phpMyAdmin configuration for auto-login (LOCAL DEVELOPMENT ONLY)
 *
 * WARNING: These credentials match docker-compose.yml defaults.
 * Do NOT use these credentials in any shared or production environment.
 */

// This is needed for cookie based authentication
$cfg['blowfish_secret'] = 'change-this-to-a-random-32-char-string';

// Server configuration
$i = 0;
$i++;

$cfg['Servers'][$i]['auth_type'] = 'config';
$cfg['Servers'][$i]['host'] = 'mysql';
$cfg['Servers'][$i]['port'] = '3306';
$cfg['Servers'][$i]['user'] = 'root';
$cfg['Servers'][$i]['password'] = 'rootpassword';
$cfg['Servers'][$i]['compress'] = false;
$cfg['Servers'][$i]['AllowNoPassword'] = true;

// Other settings
$cfg['UploadDir'] = '';
$cfg['SaveDir'] = '';
