#!/usr/bin/env python3
"""
数据分析引擎 - 基于 XGBoost + SHAP 的迭代参数分析与最优推断
"""
import json
import sys
import numpy as np
import warnings
from itertools import product

warnings.filterwarnings('ignore')

HAS_XGB = False
HAS_SHAP = False

try:
    import xgboost as xgb
    HAS_XGB = True
except ImportError:
    pass

try:
    import shap
    HAS_SHAP = True
except ImportError:
    pass

from sklearn.linear_model import Ridge
from sklearn.preprocessing import PolynomialFeatures, StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import r2_score


def _safe_float(v):
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0


def analyze(data: dict) -> dict:
    report = data.get('report', {})
    target = data.get('target', 'score')
    direction = data.get('direction', 'max')  # 'max' 或 'min'
    rank = int(data.get('rank', 0))  # 0=最优, 1=次优, 2=次次优
    results = report.get('results', [])
    config = report.get('config', {})

    if len(results) < 2:
        return {"error": "数据点不足，至少需要 2 个样本进行分析"}

    iteration_params = config.get('iterationParams', [])
    param_names = [p['name'] for p in iteration_params]

    # 兼容旧数据：如果没有 iterationParams，尝试从 iterationValues 推断
    if not param_names and results:
        all_keys = set()
        for r in results:
            iv = r.get('iterationValues', {})
            if iv:
                all_keys.update(iv.keys())
        param_names = sorted(all_keys)

    if not param_names:
        return {"error": "未检测到迭代参数，无法分析"}

    # 构建特征矩阵与目标向量
    X_list = []
    y_list = []
    for r in results:
        if target == 'score':
            y_list.append(r.get('score', 0))
        else:
            mr = r.get('monitorResults', {})
            if target in mr:
                y_list.append(mr[target].get('averageValue', 0))
            else:
                continue

        values = r.get('iterationValues', {})
        row = []
        for pname in param_names:
            row.append(_safe_float(values.get(pname, 0)))
        X_list.append(row)

    X = np.array(X_list, dtype=float)
    y = np.array(y_list, dtype=float)
    n_samples = len(y)

    if n_samples < 2 or X.shape[1] == 0:
        return {"error": "有效数据点不足或特征为空"}

    # 样本量策略
    use_xgb = HAS_XGB and n_samples >= 8
    use_shap = HAS_SHAP and use_xgb

    if use_xgb:
        # XGBoost surrogate model
        n_estimators = min(300, max(50, n_samples * 8))
        max_depth = min(5, max(2, n_samples // 4))
        model = xgb.XGBRegressor(
            n_estimators=n_estimators,
            max_depth=max_depth,
            learning_rate=0.08,
            subsample=min(1.0, max(0.6, (n_samples - 2) / n_samples)),
            colsample_bytree=0.9,
            objective='reg:squarederror',
            random_state=42,
            n_jobs=1,
            verbosity=0,
        )
        model.fit(X, y)
        y_pred = model.predict(X)
        r2 = float(r2_score(y, y_pred))

        if use_shap:
            try:
                explainer = shap.TreeExplainer(model)
                shap_values = explainer.shap_values(X)
                # 处理二分类返回值
                if isinstance(shap_values, list):
                    shap_values = shap_values[0]
                shap_values = np.array(shap_values)
                shap_importance = np.abs(shap_values).mean(axis=0)
            except Exception:
                shap_values = np.zeros_like(X)
                shap_importance = np.zeros(X.shape[1])
        else:
            shap_values = np.zeros_like(X)
            shap_importance = np.zeros(X.shape[1])

        xgb_importance = model.feature_importances_
    else:
        # 小样本：多项式回归 + Ridge
        degree = min(2, max(1, n_samples // 5))
        model = Pipeline([
            ('scaler', StandardScaler()),
            ('poly', PolynomialFeatures(degree=degree, include_bias=False)),
            ('reg', Ridge(alpha=1.0))
        ])
        model.fit(X, y)
        y_pred = model.predict(X)
        r2 = float(r2_score(y, y_pred))

        shap_values = np.zeros_like(X)
        shap_importance = np.zeros(X.shape[1])
        xgb_importance = np.zeros(X.shape[1])
        for i in range(X.shape[1]):
            corr = np.corrcoef(X[:, i], y)[0, 1]
            xgb_importance[i] = 0.0 if np.isnan(corr) else abs(corr)
        if xgb_importance.sum() > 0:
            xgb_importance = xgb_importance / xgb_importance.sum()
        shap_importance = xgb_importance.copy()

    # 特征重要性汇总
    importance_list = []
    for i, pname in enumerate(param_names):
        corr = np.corrcoef(X[:, i], y)[0, 1]
        importance_list.append({
            "feature": pname,
            "shap_importance": round(float(shap_importance[i]), 4),
            "xgb_importance": round(float(xgb_importance[i]), 4),
            "correlation": round(0.0 if np.isnan(corr) else float(corr), 4)
        })
    importance_list.sort(key=lambda x: x['shap_importance'], reverse=True)

    # 计算各参数的影响比重（百分比）
    total_shap = sum(item['shap_importance'] for item in importance_list)
    if total_shap > 0:
        for item in importance_list:
            item['impact_ratio'] = round(item['shap_importance'] / total_shap * 100, 2)
    else:
        for item in importance_list:
            item['impact_ratio'] = round(100.0 / len(importance_list), 2)

    # ========== 最优点推断 ==========
    param_defs = {p['name']: p for p in iteration_params}
    optimal_values = {}
    best_score = -float('inf')

    # 构建搜索空间
    search_grids = []
    for pname in param_names:
        pdef = param_defs.get(pname, {})
        mode = pdef.get('mode', 'range')
        if mode == 'custom':
            vals = sorted(set(_safe_float(v) for v in pdef.get('values', [])))
            if not vals:
                vals = sorted(set(X[:, param_names.index(pname)].tolist()))
        else:
            start = _safe_float(pdef.get('start', X[:, param_names.index(pname)].min()))
            end = _safe_float(pdef.get('end', X[:, param_names.index(pname)].max()))
            step = _safe_float(pdef.get('step', (end - start) / 20))
            if step <= 0:
                step = 1.0
            vals = np.arange(start, end + step, step).tolist()
        search_grids.append(vals)

    # 笛卡尔积搜索（限制规模）
    total_combinations = 1
    for g in search_grids:
        total_combinations *= max(len(g), 1)

    search_points = []
    if total_combinations <= 200000:
        for combo in product(*search_grids):
            search_points.append(list(combo))
    else:
        # 大规模随机采样 + 已有数据
        np.random.seed(42)
        for _ in range(50000):
            pt = [float(np.random.choice(g)) for g in search_grids]
            search_points.append(pt)
        # 把已有数据也加进去
        for row in X.tolist():
            search_points.append(row)
        search_points = [list(x) for x in set(tuple(x) for x in search_points)]

    # 推断前3个点（按方向排序）
    top3_inferred = []
    if search_points:
        X_search = np.array(search_points, dtype=float)
        y_search = model.predict(X_search)
        if direction == 'min':
            sorted_indices = np.argsort(y_search)
        else:
            sorted_indices = np.argsort(y_search)[::-1]
        for i in range(min(3, len(sorted_indices))):
            idx = sorted_indices[i]
            top3_inferred.append({
                "rank": i,
                "values": {pname: round(float(X_search[idx, j]), 4) for j, pname in enumerate(param_names)},
                "predicted_score": round(float(y_search[idx]), 4)
            })
    else:
        if direction == 'min':
            sorted_indices = np.argsort(y)
        else:
            sorted_indices = np.argsort(y)[::-1]
        for i in range(min(3, len(sorted_indices))):
            idx = sorted_indices[i]
            top3_inferred.append({
                "rank": i,
                "values": {pname: round(float(X[idx, j]), 4) for j, pname in enumerate(param_names)},
                "predicted_score": round(float(y[idx]), 4)
            })

    selected_rank = min(rank, len(top3_inferred) - 1) if top3_inferred else 0
    optimal_point = top3_inferred[selected_rank] if top3_inferred else {"values": {}, "predicted_score": 0}

    # 已有数据中的实际前3（仅用于展示参考，始终按同一方向）
    if direction == 'min':
        actual_sorted_indices = np.argsort(y)
    else:
        actual_sorted_indices = np.argsort(y)[::-1]

    top3_actual = []
    for i in range(min(3, len(actual_sorted_indices))):
        idx = actual_sorted_indices[i]
        top3_actual.append({
            "rank": i,
            "values": {pname: round(float(X[idx, j]), 4) for j, pname in enumerate(param_names)},
            "actual_score": round(float(y[idx]), 4)
        })

    actual_best = top3_actual[0] if top3_actual else {"values": {}, "actual_score": 0}

    # 参数影响曲线
    parameter_effects = []
    for i, pname in enumerate(param_names):
        effect_data = []
        unique_vals = np.unique(X[:, i])
        if len(unique_vals) > 25:
            unique_vals = np.linspace(X[:, i].min(), X[:, i].max(), 25)

        for val in unique_vals:
            val_f = float(val)
            if use_xgb and use_shap:
                idx = int(np.argmin(np.abs(X[:, i] - val_f)))
                effect_data.append({
                    "x": round(val_f, 4),
                    "shap": round(float(shap_values[idx, i]), 4),
                    "actual_y": round(float(y[idx]), 4)
                })
            else:
                # 找邻近样本的平均实际值
                std_i = X[:, i].std()
                tol = std_i * 0.4 + 1e-6
                mask = np.abs(X[:, i] - val_f) <= tol
                avg_y = float(y[mask].mean()) if np.any(mask) else float(y.mean())
                effect_data.append({
                    "x": round(val_f, 4),
                    "shap": 0.0,
                    "actual_y": round(avg_y, 4)
                })
        parameter_effects.append({
            "feature": pname,
            "data": effect_data
        })

    # 全局 SHAP 瀑布图数据（取选中的排名样本）
    waterfall_data = None
    if use_shap and search_points:
        selected_values = optimal_point["values"]
        opt_row = np.array([selected_values[p] for p in param_names], dtype=float).reshape(1, -1)
        try:
            sv = explainer.shap_values(opt_row)
            if isinstance(sv, list):
                sv = sv[0]
            sv = np.array(sv).flatten()
            base_val = float(explainer.expected_value)
            if isinstance(base_val, np.ndarray):
                base_val = float(base_val[0])
            waterfall_data = {
                "base_value": round(base_val, 4),
                "features": [
                    {
                        "feature": pname,
                        "value": round(float(opt_row[0, i]), 4),
                        "shap": round(float(sv[i]), 4)
                    }
                    for i, pname in enumerate(param_names)
                ],
                "final_prediction": round(float(base_val + sv.sum()), 4)
            }
        except Exception:
            pass

    return {
        "success": True,
        "model_type": "xgboost" if use_xgb else "polynomial_regression",
        "model_r2": round(r2, 4),
        "samples": n_samples,
        "features": param_names,
        "target": target,
        "direction": direction,
        "rank": selected_rank,
        "optimal_point": optimal_point,
        "top3_inferred": top3_inferred,
        "actual_best": actual_best,
        "top3_actual": top3_actual,
        "feature_importance": importance_list,
        "parameter_effects": parameter_effects,
        "waterfall_data": waterfall_data,
        "algorithm_note": (
            "当前采用 XGBoost 代理模型 + SHAP 可解释分析。"
            "XGBoost 在处理表格型非线性关系上表现卓越；"
            "SHAP（SHapley Additive exPlanations）基于博弈论，"
            "能精确量化每个迭代参数对性能分数的边际贡献。"
            if use_xgb else
            "当前样本量较小（<8），采用多项式回归 + Ridge 正则化，"
            "以相关系数与模型系数衡量参数影响，避免过拟合。"
        ),
        "optimization_note": (
            "最优点通过遍历参数空间（笛卡尔积或随机采样）"
            "并在 XGBoost 代理模型上搜索全局最大值得出。"
            if use_xgb else
            "最优点基于实际观测数据中的最佳表现，"
            "并结合模型在参数空间内的插值推断。"
        )
    }


if __name__ == '__main__':
    # 强制 stdout 使用 UTF-8，避免 Windows 平台中文乱码
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    else:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

    input_data = json.load(sys.stdin)
    result = analyze(input_data)
    print(json.dumps(result, ensure_ascii=False))
