/**
 * TRPGシナリオ執筆エディタ - GASバックエンドスクリプト
 * 
 * このスクリプトは、Googleスプレッドシートの「拡張機能」＞「Apps Script」に貼り付けて使用します。
 * スプレッドシートをデータベースとして利用し、シナリオとNPCのデータを管理します。
 */

// 1. Webアプリの公開エントリーポイント
function doGet() {
  // スプレッドシートとシートの初期化チェック
  initSpreadsheet();
  
  // index.html ファイルを読み込んで配信
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('TRPGシナリオエディタ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 2. スプレッドシートの初期設定（シートがない場合は自動作成）
function initSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // scenariosシートの確認・作成
  let scenarioSheet = ss.getSheetByName('scenarios');
  if (!scenarioSheet) {
    scenarioSheet = ss.insertSheet('scenarios');
    scenarioSheet.appendRow(['ID', 'Title', 'Content', 'CreatedAt', 'UpdatedAt']);
    scenarioSheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#f3f4f6');
    scenarioSheet.setFrozenRows(1);
  }
  
  // npcsシートの確認・作成 (フェーズ4用)
  let npcSheet = ss.getSheetByName('npcs');
  if (!npcSheet) {
    npcSheet = ss.insertSheet('npcs');
    npcSheet.appendRow(['ID', 'ScenarioID', 'Name', 'AvatarUrl', 'StatusJson', 'Memo', 'CreatedAt', 'UpdatedAt']);
    npcSheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#f3f4f6');
    npcSheet.setFrozenRows(1);
  }
}

// Helper: シートのデータをオブジェクト配列に変換する
function getRowsData(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  return values.map((row, rowIndex) => {
    const obj = { _rowNumber: rowIndex + 2 }; // スプレッドシート上の行番号（更新/削除用）
    headers.forEach((header, index) => {
      obj[header.toLowerCase()] = row[index];
    });
    return obj;
  });
}

// 3. API: シナリオ一覧の取得
function listScenarios() {
  try {
    initSpreadsheet();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('scenarios');
    const data = getRowsData(sheet);
    
    // 一覧用なのでContentは除外して軽量化
    return data.map(item => ({
      id: item.id,
      title: item.title,
      updated_at: item.updatedat instanceof Date ? item.updatedat.toISOString() : item.updatedat
    }));
  } catch (e) {
    throw new Error('シナリオ一覧の取得に失敗しました: ' + e.message);
  }
}

// 4. API: 特定シナリオの読み込み (関連するNPCデータも同時に返す)
function loadScenario(id) {
  try {
    initSpreadsheet();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // シナリオの取得
    const scenarioSheet = ss.getSheetByName('scenarios');
    const scenarios = getRowsData(scenarioSheet);
    const scenario = scenarios.find(s => s.id === id);
    
    if (!scenario) {
      throw new Error('指定されたシナリオが見つかりません。');
    }
    
    // NPCデータの取得 (フェーズ4用、なければ空配列)
    const npcSheet = ss.getSheetByName('npcs');
    const npcs = getRowsData(npcSheet);
    const scenarioNpcs = npcs.filter(n => n.scenarioid === id).map(n => ({
      id: n.id,
      name: n.name,
      avatarUrl: n.avatarurl,
      statusJson: n.statusjson,
      memo: n.memo
    }));
    
    return {
      id: scenario.id,
      title: scenario.title,
      content: scenario.content,
      npcs: scenarioNpcs
    };
  } catch (e) {
    throw new Error('シナリオの読み込みに失敗しました: ' + e.message);
  }
}

// 5. API: シナリオの保存 (新規作成または更新)
function saveScenario(id, title, content, npcsData) {
  try {
    initSpreadsheet();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const scenarioSheet = ss.getSheetByName('scenarios');
    const scenarios = getRowsData(scenarioSheet);
    
    const now = new Date();
    const existing = scenarios.find(s => s.id === id);
    
    if (existing) {
      // 既存の更新
      const rowNum = existing._rowNumber;
      scenarioSheet.getRange(rowNum, 2).setValue(title); // Title
      scenarioSheet.getRange(rowNum, 3).setValue(content); // Content
      scenarioSheet.getRange(rowNum, 5).setValue(now); // UpdatedAt
    } else {
      // 新規作成
      scenarioSheet.appendRow([id, title, content, now, now]);
    }
    
    // NPCデータの保存処理 (フェーズ4用、npcsDataが渡されていれば)
    if (npcsData && Array.isArray(npcsData)) {
      saveNpcs(id, npcsData);
    }
    
    return { success: true, updated_at: now.toISOString() };
  } catch (e) {
    throw new Error('シナリオの保存に失敗しました: ' + e.message);
  }
}

// 6. API: シナリオの削除 (関連するNPCデータも削除)
function deleteScenario(id) {
  try {
    initSpreadsheet();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. シナリオの削除
    const scenarioSheet = ss.getSheetByName('scenarios');
    const scenarios = getRowsData(scenarioSheet);
    const targetScenario = scenarios.find(s => s.id === id);
    if (targetScenario) {
      scenarioSheet.deleteRow(targetScenario._rowNumber);
    }
    
    // 2. 関連するNPCの削除
    const npcSheet = ss.getSheetByName('npcs');
    let npcs = getRowsData(npcSheet);
    // 行削除でインデックスがずれるのを防ぐため、後ろからループして削除
    for (let i = npcs.length - 1; i >= 0; i--) {
      if (npcs[i].scenarioid === id) {
        npcSheet.deleteRow(npcs[i]._rowNumber);
      }
    }
    
    return { success: true };
  } catch (e) {
    throw new Error('シナリオの削除に失敗しました: ' + e.message);
  }
}

// Helper: NPCデータの一括保存
function saveNpcs(scenarioId, npcsData) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const npcSheet = ss.getSheetByName('npcs');
  
  // 一度このシナリオに紐づく既存NPCを全削除して再インサートする（シンプルな同期方法）
  const npcs = getRowsData(npcSheet);
  for (let i = npcs.length - 1; i >= 0; i--) {
    if (npcs[i].scenarioid === scenarioId) {
      npcSheet.deleteRow(npcs[i]._rowNumber);
    }
  }
  
  const now = new Date();
  npcsData.forEach(npc => {
    npcSheet.appendRow([
      npc.id,
      scenarioId,
      npc.name || 'NPC',
      npc.avatarUrl || '',
      npc.statusJson || '{}',
      npc.memo || '',
      now,
      now
    ]);
  });
}
