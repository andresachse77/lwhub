<?php
require __DIR__ . '/../iny/config.php';
$p = new PDO('mysql:host='.MYSQL_HOST.';port='.MYSQL_PORT.';dbname='.MYSQL_DATABASE.';charset=utf8mb4', MYSQL_USER, MYSQL_PASSWORD);
echo "=== players indexes ===\n";
foreach($p->query('SHOW INDEX FROM players')->fetchAll(PDO::FETCH_ASSOC) as $r)
    echo $r['Key_name'].' ['.$r['Column_name'].'] unique='.($r['Non_unique']==0?'yes':'no')."\n";
echo "\n=== player_name_history indexes ===\n";
foreach($p->query('SHOW INDEX FROM player_name_history')->fetchAll(PDO::FETCH_ASSOC) as $r)
    echo $r['Key_name'].' ['.$r['Column_name'].'] unique='.($r['Non_unique']==0?'yes':'no')."\n";
