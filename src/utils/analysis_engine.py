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


def _is_numeric(v):
    """判断值是否为纯数值（可安全转为 float）"""
    if v is None:
        return False
    if isinstance(v, (int, float)):
        return True
    s = str(v).strip()
    if s == '':
        return False
    try:
        float(s)
        return True
    except ValueError:
        return False


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
    config_names = [p['name'] for p in iteration_params]

    # 收集数据中实际存在的迭代参数键。优先以真实数据为准，
    # 避免 config.iterationParams 与 results.iterationValues 键不一致
    # （例如参数在测试后/保存报告前被重命名或修改）时，
    # 导致历史实际最优点等位置的每个迭代参数取值错误（显示为 0）。
    data_keys = set()
    for r in results:
        iv = r.get('iterationValues') or {}
        if iv:
            data_keys.update(iv.keys())

    if data_keys:
        # 按 config 顺序排列已知参数，未知参数按字典序补齐
        known = [n for n in config_names if n in data_keys]
        unknown = sorted(data_keys - set(config_names))
        param_names = known + unknown
    else:
        # 兼容旧数据：没有任何 iterationValues 时，仅能使用 config 参数名
        param_names = config_names

    if not param_names:
        return {"error": "未检测到迭代参数，无法分析"}

    # ===== 识别类别型（字符串枚举）参数并构建编码映射 =====
    # 数值型参数直接用原值；存在非纯数字取值的参数做 label-encoding
    # 参与建模，输出时再还原为原始字符串，避免全部显示为 0。
    # （custom 模式若全部是纯数字仍按数值处理，与原行为一致）
    param_values = {p: set() for p in param_names}
    for r in results:
        iv = r.get('iterationValues') or {}
        for p in param_names:
            if p in iv:
                param_values[p].add(str(iv[p]))

    is_categorical = {}
    cat_maps = {}      # pname -> {value: code}
    cat_maps_rev = {}  # pname -> {code: value}
    for p in param_names:
        vals = param_values[p]
        pdef = next((x for x in iteration_params if x.get('name') == p), None)
        mode = pdef.get('mode', 'range') if pdef else 'range'
        # 仅当存在非纯数字取值时才判为类别型；custom 模式若全部是纯数字
        # 仍按数值处理（与原行为一致），避免改变数值参数的建模语义。
        has_non_numeric = any(not _is_numeric(v) for v in vals)
        if has_non_numeric:
            all_vals = []
            if pdef:
                for v in pdef.get('values', []):
                    v = str(v).strip()
                    if v and v not in all_vals:
                        all_vals.append(v)
            for v in sorted(vals):
                if v not in all_vals:
                    all_vals.append(v)
            is_categorical[p] = True
            cat_maps[p] = {v: i for i, v in enumerate(all_vals)}
            cat_maps_rev[p] = {i: v for v, i in cat_maps[p].items()}
        else:
            is_categorical[p] = False

    def encode_value(pname, raw):
        """将参数原始值编码为数值（类别型返回 code，数值型返回 float）"""
        if is_categorical[pname]:
            return float(cat_maps[pname].get(str(raw), 0))
        return _safe_float(raw)

    def decode_values(row):
        """将模型特征行还原为参数展示值（类别型还原原始字符串）"""
        out = {}
        for j, p in enumerate(param_names):
            if is_categorical[p]:
                out[p] = cat_maps_rev[p].get(int(round(row[j])), str(row[j]))
            else:
                out[p] = round(float(row[j]), 4)
        return out

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
            row.append(encode_value(pname, values.get(pname, 0)))
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
        if is_categorical[pname]:
            # 类别型参数只在其合法枚举编码值中搜索
            search_grids.append([float(c) for c in cat_maps_rev[pname].keys()])
            continue
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
                "values": decode_values(X_search[idx]),
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
                "values": decode_values(X[idx]),
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
            "values": decode_values(X[idx]),
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
            # 类别型参数用原始字符串作为 x 轴标签
            if is_categorical[pname]:
                x_label = cat_maps_rev[pname].get(int(round(val_f)), str(val_f))
            else:
                x_label = round(val_f, 4)
            if use_xgb and use_shap:
                idx = int(np.argmin(np.abs(X[:, i] - val_f)))
                effect_data.append({
                    "x": x_label,
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
                    "x": x_label,
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
        # 类别型参数已是原始字符串，需先编码回数值再送入模型
        opt_row = np.array([encode_value(p, selected_values.get(p, 0)) for p in param_names], dtype=float).reshape(1, -1)
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
                        "value": decode_values(opt_row[0])[pname],
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
