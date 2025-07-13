function calcStats(trades) {
                if (!trades.length) return null;
                let returns = [];
                let equity = [];
                let dates = [];
                let firstEquity = 100;
                let lastEquity = null;
                let firstDate = null, lastDate = null;

                trades.forEach((t, idx) => {
                    let eq = parseFloat(t.equity);
                    if (!isNaN(eq)) {
                        equity.push(eq);
                        lastEquity = eq;
                    }
                    let dateStr = t.time.split(" ")[0].replace(/\./g, "-");
                    let dateObj = new Date("20" + dateStr.split("-").reverse().join("-"));
                    if (!isNaN(dateObj)) {
                        dates.push(dateObj);
                        if (!firstDate || dateObj < firstDate) firstDate = dateObj;
                        if (!lastDate || dateObj > lastDate) lastDate = dateObj;
                    }
                });

                let prevEq = firstEquity;
                for (let i = 0; i < equity.length; i++) {
                    let ret = (equity[i] / prevEq) - 1;
                    returns.push(ret);
                    prevEq = equity[i];
                }

                let mean = returns.reduce((a, b) => a + b, 0) / returns.length;
                let std = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length);
                let sharpe = std ? ((mean / std) * Math.sqrt(252)).toFixed(2) : "—";

                let totalReturn = ((lastEquity / firstEquity - 1) * 100).toFixed(2) + "%";

                let now = lastDate;
                let weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
                let monthAgo = new Date(now); monthAgo.setMonth(now.getMonth() - 1);

                let eqWeekAgo = firstEquity, eqMonthAgo = firstEquity;
                for (let i = 0; i < dates.length; i++) {
                    if (dates[i] <= weekAgo) eqWeekAgo = equity[i];
                    if (dates[i] <= monthAgo) eqMonthAgo = equity[i];
                }
                let weekReturn = eqWeekAgo ? ((lastEquity / eqWeekAgo - 1) * 100).toFixed(2) + "%" : "—";
                let monthReturn = eqMonthAgo ? ((lastEquity / eqMonthAgo - 1) * 100).toFixed(2) + "%" : "—";

                const n = trades.length;
                let win = 0,
                    rrSum = 0,
                    rrCount = 0,
                    maxDD = 0;
                let equityForDD = [];
                trades.forEach((t, idx) => {
                    if (t.reason === "TP") win++;
                    if (t.sl && t.tp && t.entry) {
                        let entry = parseFloat(t.entry),
                            sl = parseFloat(t.sl),
                            tp = parseFloat(t.tp);
                        if (entry && sl && tp) {
                            let rr = Math.abs((tp - entry) / (entry - sl));
                            if (isFinite(rr) && rr > 0) {
                                rrSum += rr;
                                rrCount++;
                            }
                        }
                    }
                    let eq = parseFloat(t.equity);
                    if (!isNaN(eq)) equityForDD.push(eq);
                });
                if (equityForDD.length > 0) {
                    let peak = equityForDD[0];
                    for (let i = 1; i < equityForDD.length; i++) {
                        if (equityForDD[i] > peak) peak = equityForDD[i];
                        let dd = (peak - equityForDD[i]) / peak;
                        if (dd > maxDD) maxDD = dd;
                    }
                }
                let winRate = ((win / n) * 100).toFixed(1) + "%";
                let avgRR = rrCount ? (rrSum / rrCount).toFixed(2) : "—";
                let maxDraw = maxDD ? (maxDD * 100).toFixed(2) + "%" : "—";
                let dayCount = firstDate && lastDate ? Math.round((lastDate - firstDate) / 86400000) + 1 : null;
                return {
                    sharpe,
                    winRate,
                    avgRR,
                    maxDraw,
                    monthNet: monthReturn,
                    weekNet: weekReturn,
                    n,
                    totalReturn,
                    dayCount,
                };
            }
            function parseTrades(data) {
                return data
                    .trim()
                    .replace(/\r\n/g, "\n")
                    .replace(/\r/g, "\n")
                    .split("\n")
                    .filter((row) => row.trim())
                    .map((row) => {
                        const match = row.match(
                            /^\[(.+?)\] (.+?) (SHORT|LONG) - Entry: (.+?), SL: (.+?), TP: (.+?), Exit: (.+?), Reason: (.+?), Result: (.+?), Equity: (.+?)$/,
                        );
                        if (match) {
                            const [
                                ,
                                time,
                                coin,
                                direction,
                                entry,
                                sl,
                                tp,
                                exit,
                                reason,
                                result,
                                equity,
                            ] = match;
                            return {
                                time,
                                coin,
                                direction,
                                entry,
                                sl,
                                tp,
                                exit,
                                reason,
                                result,
                                equity,
                            };
                        }
                        return null;
                    })
                    .filter(Boolean);
            }

            function loadTradesGeneric(
                csv,
                statsBarId,
                tableId,
                totalReturnBarId,
                paginationId,
            ) {
                fetch(csv, { cache: "no-cache" })
                    .then((r) => r.text())
                    .then((data) => {
                        const trades = parseTrades(data);
                        const stats = calcStats(trades);
                        renderStatsBarTo(stats, statsBarId);
                        
                        if (totalReturnBarId && stats) {
                            const uniq = totalReturnBarId.replace(/[^a-zA-Z0-9]/g, "");
                            const boxId = `total-return-box-${uniq}`;
                            const iconId = `equity-graph-icon-${uniq}`;
                            const modalId = `equity-modal-${uniq}`;
                            const closeId = `close-equity-modal-${uniq}`;
                            const chartId = `equity-chart-${uniq}`;
                            const bar = document.getElementById(totalReturnBarId);
                            const lang = (
                                navigator.language ||
                                navigator.userLanguage ||
                                ""
                            ).toLowerCase();
                            const isTR = lang.startsWith("tr");
                            let label, info;
                            label = stats.dayCount
                                ? `Total Return (${stats.dayCount} days)`
                                : "Total Return";
                            if (isTR) {
                                info =
                                    "Toplam Getiri: Tüm işlemlerden elde edilen net yüzde getiri. Parantez içindeki sayı, bu getirinin kaç günde elde edildiğini gösterir.";
                            } else {
                                info =
                                    "Total Return: Net percentage return from all trades. The number in parentheses shows over how many days this return was achieved.";
                            }
                            const returnValue = parseFloat(
                                stats.totalReturn.replace("%", ""),
                            );
                            const valueColorClass =
                                returnValue >= 0
                                    ? "stat-total-positive"
                                    : "stat-total-negative";
                            bar.innerHTML = `
              <div style="display: flex; align-items: center; gap: 0;">
                <div class="stat-box stat-total stat-total-single" id="${boxId}" style="
                  transition-property: background-color, border-color, color, fill, stroke, opacity, box-shadow, transform;
                  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
                  transition-duration: 300ms;">
                  <span class="stat-total-label">${label}:</span>
                  <span class="stat-total-value ${valueColorClass}">${stats.totalReturn}</span>
                </div>
                <span id="${iconId}" style="margin-left:18px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 2px 12px #0005;background:linear-gradient(135deg, #23243a 80%, #4f46e5 100%);border-radius:10px;padding:7px 10px;transition:transform 0.3s ease,box-shadow 0.3s ease,border 0.3s ease; border:2px solid #3b3b5c;">
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style="display:block;" xmlns="http://www.w3.org/2000/svg">
                    <rect x="2" y="3" width="24" height="20" rx="6" fill="#181a20" stroke="#4f46e5" stroke-width="1.7"/>
                    <path d="M7 19L13 12L16 16L22 8" stroke="#06a091" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="7" cy="19" r="1.5" fill="#06a091"/>
                    <circle cx="13" cy="12" r="1.5" fill="#06a091"/>
                    <circle cx="16" cy="16" r="1.5" fill="#06a091"/>
                    <circle cx="22" cy="8" r="1.5" fill="#06a091"/>
                  </svg>
                </span>
              </div>
              <div id="${modalId}" style="display:none;position:fixed;z-index:99999;inset:0;min-width:100vw;min-height:100vh;background:rgba(18,20,30,0);align-items:center;justify-content:center;transition:background 0.3s ease;pointer-events:none;overflow-x:hidden;">
                <div style="background:#0e1016;padding:32px 18px 18px 18px;border-radius:18px;box-shadow:0 8px 48px #000b;max-width:98vw;max-height:90vh;position:relative;min-width:340px;transform:scale(0.8);opacity:0;transition:transform 0.3s ease, opacity 0.3s ease;">
                  <button id="${closeId}" style="position:absolute;top:10px;right:14px;background:none;border:none;color:#eaeaea;font-size:2em;cursor:pointer;">&times;</button>
                  <div style="font-size:1.18em;font-weight:600;color:#c7bfff;margin-bottom:16px;text-align:center;letter-spacing:1px;">Equity Change Over Time</div>
                  <canvas id="${chartId}" width="1100" height="500" style="background:#181a20;border-radius:13px;max-width:99vw;max-height:80vh;box-shadow:0 2px 24px #0007;"></canvas>
                  <div id="rotate-warning-${uniq}" style="display:none; padding:38px 0 0 0;">
                    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;">
                      <svg width="70" height="70" viewBox="0 0 70 70" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;">
                        <rect x="18" y="10" width="34" height="50" rx="8" fill="#23243a" stroke="#4f46e5" stroke-width="2.5"/>
                        <rect x="28" y="16" width="14" height="38" rx="3.5" fill="#181a20" stroke="#06a091" stroke-width="1.5"/>
                        <path d="M60 35a25 25 0 1 0-8.5 18.5" stroke="#fbbf24" stroke-width="3" stroke-linecap="round" stroke-dasharray="6 7"/>
                        <path d="M56 56l-4.5-2.5 2.5-4.5" stroke="#fbbf24" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                      <div style="color:#fbbf24;font-size:1.22em;font-weight:600;text-align:center;letter-spacing:0.01em;">Please rotate your device</div>
                      <div style="color:#b3b3d7;font-size:1em;font-weight:400;text-align:center;max-width:260px;opacity:0.85;">For the best chart experience, view in landscape mode.</div>
                    </div>
                  </div>
                </div>
              </div>
            `;
                            setTimeout(() => {
                              const box = document.getElementById(boxId);
                              const icon = document.getElementById(iconId);
                              const modal = document.getElementById(modalId);
                              const closeBtn = document.getElementById(closeId);
                              if (!box || !icon || !modal || !closeBtn) return;

                              box.onclick = function(e) {

                                if (e.target === icon || icon.contains(e.target)) {
                                  return;
                                }

                                const rect = box.getBoundingClientRect();
                                let x = rect.left + rect.width / 2 - 160;
                                let y = rect.bottom + 12;
                                if (y + 100 > window.innerHeight) {
                                  y = rect.top - 70;
                                }
                                const popup = document.getElementById("info-popup");
                                if (popup) {
                                  popup.textContent = info;
                                  popup.style.display = "block";
                                  popup.style.opacity = "0";
                                  popup.style.left = x + "px";
                                  popup.style.top = y + "px";
                                  popup.style.opacity = "1";
                                }
                                e.stopPropagation();
                              };


                              function handleEquityChartDisplay() {
                                const canvas = document.getElementById(chartId);
                                const warning = document.getElementById(`rotate-warning-${uniq}`);
                                if (window.innerWidth < 700 && window.innerHeight > window.innerWidth) {
                                  if (canvas) canvas.style.display = 'none';
                                  if (warning) warning.style.display = 'block';
                                } else {
                                  if (warning) warning.style.display = 'none';
                                  if (canvas) {
                                    canvas.style.display = 'block';
                                    drawEquityChart(trades, chartId);
                                  }
                                }
                              }

                              icon.onclick = function(e) {
                                modal.style.display = "flex";
                                modal.style.pointerEvents = "auto";
                                const modalContent = modal.children[0];

                                setTimeout(() => {
                                  modal.style.background = "rgba(18,20,30,0.92)";
                                  modalContent.style.transform = "scale(1)";
                                  modalContent.style.opacity = "1";
                                }, 10);

                                setTimeout(() => {
                                  handleEquityChartDisplay();
                                }, 150);
                                window.removeEventListener('resize', handleEquityChartDisplay);
                                window.removeEventListener('orientationchange', handleEquityChartDisplay);
                                window.addEventListener('resize', handleEquityChartDisplay);
                                window.addEventListener('orientationchange', handleEquityChartDisplay);
                                e.stopPropagation();
                              };
                              
                              closeBtn.onclick = function() {
                                const modalContent = modal.children[0];

                                modal.style.background = "rgba(18,20,30,0)";
                                modalContent.style.transform = "scale(0.8)";
                                modalContent.style.opacity = "0";

                                setTimeout(() => {
                                  modal.style.display = "none";
                                  modal.style.pointerEvents = "none";
                                  window.removeEventListener('resize', handleEquityChartDisplay);
                                  window.removeEventListener('orientationchange', handleEquityChartDisplay);
                                }, 300);
                              };
                              modal.onclick = function(e) {
                                if (e.target === modal) {
                                  const modalContent = modal.children[0];

                                  modal.style.background = "rgba(18,20,30,0)";
                                  modalContent.style.transform = "scale(0.8)";
                                  modalContent.style.opacity = "0";

                                  setTimeout(() => {
                                    modal.style.display = "none";
                                    modal.style.pointerEvents = "none";
                                    window.removeEventListener('resize', handleEquityChartDisplay);
                                    window.removeEventListener('orientationchange', handleEquityChartDisplay);
                                  }, 300);
                                }
                              };
                            }, 0);
        function drawEquityChart(trades, canvasId) {
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            const dpr = window.devicePixelRatio || 1;
            let parent = canvas.parentElement;
    let maxW = 1100, maxH = 500;
    let minW = 600;
    let availW = Math.max(minW, Math.min(
        maxW,
        window.innerWidth * 0.99,
        parent ? parent.clientWidth * 0.98 : maxW
    ));
    let availH = Math.min(
        maxH,
        window.innerHeight * 0.80,
        parent ? parent.clientHeight * 0.98 : maxH
    );
    let aspect = maxW / maxH;
    if (availW / availH > aspect) {
        availW = availH * aspect;
    } else {
        availH = availW / aspect;
    }
    const cssWidth = Math.round(availW);
    const cssHeight = Math.round(availH);
            canvas.style.width = cssWidth + "px";
            canvas.style.height = cssHeight + "px";
            canvas.width = cssWidth * dpr;
            canvas.height = cssHeight * dpr;
            const ctx = canvas.getContext("2d");
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, cssWidth, cssHeight);
            let dayMap = {};
            trades.forEach(t => {
                let eq = parseFloat(t.equity);
                let timeParts = t.time.split(" - ");
                let closeDateStr = timeParts.length > 1 ? timeParts[1].split(" ")[0] : timeParts[0].split(" ")[0];
                closeDateStr = closeDateStr.replace(/\./g, "-");
                let dateObj = new Date("20" + closeDateStr.split("-").reverse().join("-"));
                if (!isNaN(eq) && !isNaN(dateObj)) {
                    let key = dateObj.toISOString().slice(0,10);
                    dayMap[key] = {eq, date: new Date(key)};
                }
            });
            let points = Object.values(dayMap).sort((a,b)=>a.date-b.date);

            if (points.length > 0) {
                let firstDate = new Date(points[0].date.getTime());
                firstDate.setDate(firstDate.getDate() - 1);
                points.unshift({ eq: 100, date: firstDate });
            } else {
                let yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                points.push({ eq: 100, date: yesterday });
            }
            if (points.length < 2) {
                ctx.fillStyle = "#eaeaea";
                ctx.font = "18px 'Consolas', 'Menlo', 'monospace'";
                ctx.fillText("Not enough data", 30, canvas.height/2);
                return;
            }
            let minEq = Math.min(...points.map(p=>p.eq));
            let maxEq = Math.max(...points.map(p=>p.eq));

            let minPct = ((minEq-100)/100)*100;
            let maxPct = ((maxEq-100)/100)*100;

            let dataRange = maxPct - minPct;

            let targetLabels = 6;
            let minStep = 1;
            let maxStep = 100000;
            let bestStep = 1;
            let bestDiff = Infinity;
            let stepCandidates = [];
            let baseSteps = [1,2,5];
            for(let exp=0; exp<6; exp++) {
                let pow = Math.pow(10, exp);
                baseSteps.forEach(bs => stepCandidates.push(bs*pow));
            }
            for(let s of stepCandidates) {
                let margin = Math.max(s * 0.5, dataRange * 0.1);
                let expandedMin = minPct - margin;
                let expandedMax = maxPct + margin;
                let minPctLabel = Math.floor(expandedMin / s) * s;
                let maxPctLabel = Math.ceil(expandedMax / s) * s;
                if (minEq >= 100 && minPctLabel < 0) minPctLabel = 0;
                let totalRange = maxPctLabel - minPctLabel;
                let labelCount = Math.round(totalRange / s) + 1;
                let diff = Math.abs(labelCount - targetLabels);
                if (labelCount >= 5 && labelCount <= 7 && diff < bestDiff) {
                    bestStep = s;
                    bestDiff = diff;
                }
            }
            let step = bestStep;
            let margin = Math.max(step * 0.5, dataRange * 0.1);
            let expandedMin = minPct - margin;
            let expandedMax = maxPct + margin;
            let minPctLabel = Math.floor(expandedMin / step) * step;
            let maxPctLabel = Math.ceil(expandedMax / step) * step;
            if (minEq >= 100 && minPctLabel < 0) minPctLabel = 0;
            let totalRange = maxPctLabel - minPctLabel;
            let minEqFixed = 100 + minPctLabel;
            let maxEqFixed = 100 + maxPctLabel;

            let minDate = points[0].date;
            let maxDate = points[points.length-1].date;
            let padY = Math.max(32, cssHeight * 0.13), padX = Math.max(36, cssWidth * 0.085);
            let W = cssWidth, H = cssHeight;

            ctx.save();
            ctx.strokeStyle = "#23272f";
            ctx.lineWidth = 1.1;
            ctx.globalAlpha = 0.6;
            ctx.setLineDash([4, 7]);

            let yLabelCount = Math.round(totalRange / step) + 1;
            for(let i=0; i<yLabelCount; i++){
                let y = padY + (H-2*padY)*(1-i/(yLabelCount-1));
                ctx.beginPath();
                ctx.moveTo(padX, y);
                ctx.lineTo(W-padX, y);
                ctx.stroke();
            }
            ctx.globalAlpha = 0.4;
            ctx.setLineDash([2, 8]);
            let nLabelsGrid = Math.min(5, points.length);
            for(let i=0;i<nLabelsGrid;i++){
                let idx = Math.round(i*(points.length-1)/(nLabelsGrid-1));
                let x = padX + (W-2*padX)*(points[idx].date-minDate)/(maxDate-minDate||1);
                ctx.beginPath();
                ctx.moveTo(x, padY);
                ctx.lineTo(x, H-padY);
                ctx.stroke();
            }
            ctx.setLineDash([]);
            ctx.restore();
            ctx.save();

            let axisGrad = ctx.createLinearGradient(padX, padY, W-padX, H-padY);
            axisGrad.addColorStop(0, "#3b3b5c");
            axisGrad.addColorStop(0.5, "#4f46e5");
            axisGrad.addColorStop(1, "#5c5c7a");
            ctx.strokeStyle = axisGrad;
            ctx.lineWidth = 1.8;
            ctx.shadowColor = "#4f46e522";
            ctx.shadowBlur = 3;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            ctx.moveTo(padX, padY);
            ctx.lineTo(padX, H-padY);
            ctx.lineTo(W-padX, H-padY);
            ctx.stroke();
            ctx.restore();

            ctx.save();
            ctx.fillStyle = "#b3b3d7";
            ctx.font = `bold ${Math.max(12, Math.round(cssHeight*0.045))}px 'Consolas', 'Menlo', 'monospace'`;
            ctx.textAlign = "right";
            ctx.textBaseline = "middle";
            ctx.shadowColor = "#000";
            ctx.shadowBlur = 2;
            ctx.shadowOffsetX = 0.5;
            ctx.shadowOffsetY = 0.5;
            
            let yLabelCount2 = Math.round(totalRange / step) + 1;
            for(let i=0; i<yLabelCount2; i++){
                let y = padY + (H-2*padY)*(1-i/(yLabelCount2-1));
                let pct = minPctLabel + (step * i);
                let decimals = step >= 2 ? 0 : 1;
                ctx.fillText(pct.toFixed(decimals) + "%", padX-16, y);
            }
            ctx.restore();

            ctx.save();
            let grad2 = ctx.createLinearGradient(padX, padY, W-padX, padY);
            grad2.addColorStop(0, "#0891b2");
            grad2.addColorStop(0.3, "#06a091");
            grad2.addColorStop(0.7, "#10b981");
            grad2.addColorStop(1, "#22c55e");
            ctx.strokeStyle = grad2;
            ctx.lineWidth = Math.max(2.2, cssWidth*0.0055);
            ctx.shadowColor = "#06a09199";
            ctx.shadowBlur = 12;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 2;
            
            let xy2 = points.map((p,i)=>{
                let x = padX + (W-2*padX)*(p.date-minDate)/(maxDate-minDate||1);
                let y = padY + (H-2*padY)*(1-(p.eq-minEqFixed)/(maxEqFixed-minEqFixed));
                return {x,y};
            });
            ctx.beginPath();
            if (xy2.length > 1) {
                ctx.moveTo(xy2[0].x, xy2[0].y);
                for (let i = 0; i < xy2.length - 1; i++) {
                    let p0 = xy2[i > 0 ? i - 1 : 0];
                    let p1 = xy2[i];
                    let p2 = xy2[i + 1];
                    let p3 = xy2[i + 2 < xy2.length ? i + 2 : xy2.length - 1];
                    let cp1x = p1.x + (p2.x - p0.x) / 6;
                    let cp1y = p1.y + (p2.y - p0.y) / 6;
                    let cp2x = p2.x - (p3.x - p1.x) / 6;
                    let cp2y = p2.y - (p3.y - p1.y) / 6;
                    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
                }
            }
            ctx.stroke();
            ctx.restore();
            ctx.save();
            xy2.forEach((pt,i)=>{
                ctx.beginPath();
                ctx.arc(pt.x,pt.y, i===xy2.length-1 ? Math.max(4, cssWidth*0.007) : Math.max(2.2, cssWidth*0.0045),0,2*Math.PI);
                ctx.fillStyle = i===xy2.length-1 ? "#06a091" : "#b3b3d7";
                ctx.shadowColor = i===xy2.length-1 ? "#06a091" : "#23272f";
                ctx.shadowBlur = i===xy2.length-1 ? 16 : 4;
                ctx.fill();
                ctx.shadowBlur = 0;
            });
            ctx.restore();
            ctx.save();
            ctx.font = `bold ${Math.max(11, Math.round(cssHeight*0.04))}px 'Consolas', 'Menlo', 'monospace'`;
            ctx.fillStyle = "#b3b3d7";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.shadowColor = "#000";
            ctx.shadowBlur = 2;
            ctx.shadowOffsetX = 0.5;
            ctx.shadowOffsetY = 0.5;
            let minXLabels = 5, maxXLabels = 9;
            let n = points.length;
            let bestIndices = [];
            let bestXDiff = Infinity;
            for (let targetLabels = minXLabels; targetLabels <= maxXLabels; targetLabels++) {
                let indices = [];
                if (n <= targetLabels) {
                    for (let i = 0; i < n; i++) indices.push(i);
                } else {
                    let step = Math.ceil(n / targetLabels);
                    if (step <= 7) {
                        for (let i = 0; i < n; i += step) indices.push(i);
                    } else if (step <= 28) {
                        let lastWeek = null;
                        for (let i = 0; i < n; i++) {
                            let d = points[i].date;
                            let week = d.getFullYear() + '-' + d.getMonth() + '-' + Math.floor(d.getDate() / 7);
                            if (week !== lastWeek) {
                                indices.push(i);
                                lastWeek = week;
                            }
                        }
                    } else {
                        let lastMonth = null;
                        for (let i = 0; i < n; i++) {
                            let d = points[i].date;
                            let month = d.getFullYear() + '-' + d.getMonth();
                            if (month !== lastMonth) {
                                indices.push(i);
                                lastMonth = month;
                            }
                        }
                    }
                    if (!indices.includes(0)) indices.unshift(0);
                    if (!indices.includes(n-1)) indices.push(n-1);
                    indices = Array.from(new Set(indices)).sort((a,b)=>a-b);
                }
                let diff = Math.abs(indices.length - targetLabels);
                if (indices.length >= minXLabels && indices.length <= maxXLabels && diff < bestXDiff) {
                    bestIndices = indices;
                    bestXDiff = diff;
                }
            }
            let indices = bestIndices.length ? bestIndices : [0, n-1];
            for(let k=0; k<indices.length; k++){
                let idx = indices[k];
                let p = points[idx];
                let x = padX + (W-2*padX)*(p.date-minDate)/(maxDate-minDate||1);
                let label;
                const lang = (navigator.language || navigator.userLanguage || '').toLowerCase();
                const isTR = lang.startsWith('tr');
                const europeanLangs = [
                  'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'cs', 'da', 'fi', 'sv', 'no', 'hu', 'el', 'ro', 'bg', 'hr', 'lt', 'lv', 'et', 'sk', 'sl', 'mt', 'ga', 'eu', 'ca', 'is', 'sq', 'bs', 'mk', 'sr', 'tr'
                ];
                const isEU = europeanLangs.some(code => lang.startsWith(code));
                if (isTR || isEU) {
                    if (n > 28 && (k === 0 || k === indices.length-1 || indices.length <= 6)) {
                        const month = (p.date.getMonth() + 1).toString().padStart(2, '0');
                        const year = p.date.getFullYear().toString().slice(-2);
                        label = `${month}.${year}`;
                    } else {
                        const day = p.date.getDate().toString().padStart(2, '0');
                        const month = (p.date.getMonth() + 1).toString().padStart(2, '0');
                        label = `${day}.${month}`;
                    }
                } else if (n > 28 && (k === 0 || k === indices.length-1 || indices.length <= 6)) {
                    label = p.date.toLocaleDateString(undefined, { year: '2-digit', month: '2-digit' });
                } else {
                    label = p.date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });
                }
                ctx.fillText(label, x, H-padY+12);
            }
            ctx.restore();
        }
                        }

                        const tradesPerPage = 7;

                        if (!window._currentPages) window._currentPages = {};
                        if (!window._currentPages[tableId]) window._currentPages[tableId] = 1;
                        let currentPage = window._currentPages[tableId];
                        const totalTrades = trades.length;
                        const totalPages = Math.ceil(totalTrades / tradesPerPage);
                        
                        function renderTrades(page = 1) {
                            window._currentPages[tableId] = page;
                            currentPage = page;
                            const tbody = document.querySelector(`#${tableId} tbody`);
                            tbody.innerHTML = "";
                            
    const isMobile = window.innerWidth <= 1000;
    const isBreakpoint = window.innerWidth >= 950 && window.innerWidth <= 1050;

    function convertIstanbulToLocal(timeStr) {
    if (!timeStr) return timeStr;
    const [datePart, timePart] = timeStr.split(' ');
    if (!datePart) return timeStr;
    const [day, month, year] = datePart.split('.');
    let dt;
    if (timePart) {
        const [hour, minute] = timePart.split(':');
        dt = new Date(Date.UTC(
            2000 + parseInt(year, 10),
            parseInt(month, 10) - 1,
            parseInt(day, 10),
            parseInt(hour, 10) - 3,
            parseInt(minute, 10)
        ));
    } else {
        dt = new Date(Date.UTC(
            2000 + parseInt(year, 10),
            parseInt(month, 10) - 1,
            parseInt(day, 10)
        ));
    }
    const lang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    const isTR = lang.startsWith('tr');
    const europeanLangs = [
      'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'cs', 'da', 'fi', 'sv', 'no', 'hu', 'el', 'ro', 'bg', 'hr', 'lt', 'lv', 'et', 'sk', 'sl', 'mt', 'ga', 'eu', 'ca', 'is', 'sq', 'bs', 'mk', 'sr', 'tr'
    ];
    const isEU = europeanLangs.some(code => lang.startsWith(code));
    if (isTR || isEU) {
        const dd = dt.getUTCDate().toString().padStart(2, '0');
        const mm = (dt.getUTCMonth() + 1).toString().padStart(2, '0');
        const yy = dt.getUTCFullYear().toString().slice(-2);
        if (timePart) {
            const hh = dt.getUTCHours().toString().padStart(2, '0');
            const min = dt.getUTCMinutes().toString().padStart(2, '0');
            return `${dd}.${mm}.${yy} ${hh}:${min}`;
        } else {
            return `${dd}.${mm}.${yy}`;
        }
    }
    return dt.toLocaleString(undefined, {
        year: '2-digit', month: '2-digit', day: '2-digit',
        hour: timePart ? '2-digit' : undefined,
        minute: timePart ? '2-digit' : undefined
    });
    }

    function formatTimeCell(timeStr) {
        if (typeof timeStr === 'string' && timeStr.includes(' - ')) {
            const [entry, exit] = timeStr.split(' - ');
            const entryLocal = convertIstanbulToLocal(entry);
            const exitLocal = convertIstanbulToLocal(exit);
            const isMobile = window.innerWidth <= 1000;
            const margin = isMobile ? '2px' : '4px';
            return `<div style="display:flex;flex-direction:column;align-items:center;line-height:1.2;">
                <span class="time-date time-exit">${exitLocal}</span>
                <span class="time-date time-entry" style="margin-top:${margin};">${entryLocal}</span>
            </div>`;
        }

        return `<span class="time-date">${convertIstanbulToLocal(timeStr)}</span>`;
    }

    function formatEntryCell(entry, sl, tp) {

        return '';
    }

    if (isMobile) {

        const startIndex = (page - 1) * tradesPerPage;
        const endIndex = startIndex + tradesPerPage;
        const paginatedTrades = trades.slice().reverse().slice(startIndex, endIndex);

        paginatedTrades.forEach((t) => {
            let percent = parseFloat(t.result.replace("%", ""));
            let profitStr = (percent > 0 ? "+" : "") + percent.toFixed(2) + "%";
            const dirClass = t.direction === "LONG" ? "dir-long" : "dir-short";
            const reasonClass = t.reason === "TP" ? "reason-tp" : "reason-sl";
            const pnlClass = percent >= 0 ? "pnl-pos" : "pnl-neg";
            const tr = document.createElement("tr");

            let entryCell = `<div style='display:flex;flex-direction:column;align-items:center;line-height:1.2;'>`;
            entryCell += `<span style='color:#eaeaea;font-weight:bold;'>${t.entry}</span>`;
            if (t.reason === "TP") {
                entryCell += `<span style='font-size:0.92em;opacity:0.8;color:#ef4444;margin-top:2px;'>SL: ${t.sl}</span>`;
            } else {
                entryCell += `<span style='font-size:0.92em;opacity:0.8;color:#3b82f6;margin-top:2px;'>TP: ${t.tp}</span>`;
            }
            entryCell += `</div>`;

            let exitCell = `<div style='display:flex;flex-direction:column;align-items:center;line-height:1.2;'>`;
            exitCell += `<span style='color:#eaeaea;font-weight:bold;'>${t.exit}</span>`;
            if (t.reason === "TP") {
                exitCell += `<span style='font-size:0.92em;opacity:0.8;color:#3b82f6;margin-top:4px;'>TP: ${t.tp}</span>`;
            } else {
                exitCell += `<span style='font-size:0.92em;ospacity:0.8;color:#ef4444;margin-top:4px;'>SL: ${t.sl}</span>`;
            }
            exitCell += `</div>`;

            tr.innerHTML = `
                <td class="time-cell">${formatTimeCell(t.time)}</td>
                <td>${t.coin}</td>
                <td class="${dirClass}">${t.direction}</td>
                <td>${entryCell}</td>
                <td>${exitCell}</td>
                <td class="${reasonClass}">${t.reason}</td>
                <td class="${pnlClass}">${profitStr}</td>
                <td>${t.equity}</td>
            `;
            tbody.appendChild(tr);
        });

        if (paginationId) {
            updatePagination(page, totalPages, paginationId);
        }
    } else {

        trades.slice().reverse().forEach((t) => {
            let percent = parseFloat(t.result.replace("%", ""));
            let profitStr = (percent > 0 ? "+" : "") + percent.toFixed(2) + "%";
            const dirClass = t.direction === "LONG" ? "dir-long" : "dir-short";
            const reasonClass = t.reason === "TP" ? "reason-tp" : "reason-sl";
            const pnlClass = percent >= 0 ? "pnl-pos" : "pnl-neg";
            const tr = document.createElement("tr");

            let entryCell = `<div style='display:flex;flex-direction:column;align-items:center;line-height:1.2;'>`;
            entryCell += `<span style='color:#eaeaea;font-weight:bold;'>${t.entry}</span>`;
            if (t.reason === "TP") {
                entryCell += `<span style='font-size:0.92em;opacity:0.8;color:#ef4444;margin-top:4px;'>SL: ${t.sl}</span>`;
            } else {
                entryCell += `<span style='font-size:0.92em;opacity:0.8;color:#3b82f6;margin-top:4px;'>TP: ${t.tp}</span>`;
            }
            entryCell += `</div>`;

            let exitCell = `<div style='display:flex;flex-direction:column;align-items:center;line-height:1.2;'>`;
            exitCell += `<span style='color:#eaeaea;font-weight:bold;'>${t.exit}</span>`;
            if (t.reason === "TP") {
                exitCell += `<span style='font-size:0.92em;opacity:0.8;color:#3b82f6;margin-top:4px;'>TP: ${t.tp}</span>`;
            } else {
                exitCell += `<span style='font-size:0.92em;opacity:0.8;color:#ef4444;margin-top:4px;'>SL: ${t.sl}</span>`;
            }
            exitCell += `</div>`;

            tr.innerHTML = `
                <td class="time-cell">${formatTimeCell(t.time)}</td>
                <td>${t.coin}</td>
                <td class="${dirClass}">${t.direction}</td>
                <td>${entryCell}</td>
                <td>${exitCell}</td>
                <td class="${reasonClass}">${t.reason}</td>
                <td class="${pnlClass}">${profitStr}</td>
                <td>${t.equity}</td>
            `;
            tbody.appendChild(tr);
        });

        if (paginationId) {
            const paginationContainer = document.getElementById(paginationId);
            if (paginationContainer) {
                paginationContainer.style.display = 'none';
            }
        }
    }
                        }
                        
                        function updatePagination(page, totalPages, paginationId) {
                            const container = document.getElementById(paginationId);
                            if (!container) return;

                            container.style.display = 'flex';
                            
                            let paginationHTML = '';

    const prevDisabled = page === 1 ? 'disabled' : '';
    paginationHTML += `<button class="pagination-button" ${prevDisabled} onclick="changePage(${page - 1}, '${tableId}', '${paginationId}')">‹</button>`;

    let maxButtons = 5;
    if (window.innerWidth <= 525) {
        maxButtons = 3;
    } else if (window.innerWidth <= 600) {
        maxButtons = 4;
    }
    let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
    let endPage = startPage + maxButtons - 1;
    if (endPage > totalPages) {
        endPage = totalPages;
        startPage = Math.max(1, endPage - maxButtons + 1);
    }
    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === page ? 'active' : '';
        paginationHTML += `<button class="pagination-button ${activeClass}" onclick="changePage(${i}, '${tableId}', '${paginationId}')">${i}</button>`;
    }

    const nextDisabled = page === totalPages ? 'disabled' : '';
    paginationHTML += `<button class="pagination-button" ${nextDisabled} onclick="changePage(${page + 1}, '${tableId}', '${paginationId}')">›</button>`;

    const startItem = (page - 1) * tradesPerPage + 1;
    const endItem = Math.min(page * tradesPerPage, totalTrades);
    const infoText = `${startItem}-${endItem} / ${totalTrades}`;
    paginationHTML += `<span class="pagination-info" style="display:inline-block;min-width:110px;text-align:center;">${infoText}</span>`;

    container.innerHTML = paginationHTML;
                        }

                        window[`changePage_${tableId}`] = function(page, tableId, paginationId) {
                            if (page < 1 || page > totalPages) return;
                            window._currentPages[tableId] = page;
                            renderTrades(page);
                        };

                        window.changePage = function(page, tableId, paginationId) {
                            window[`changePage_${tableId}`](page, tableId, paginationId);
                        };

                        renderTrades(currentPage);

                        window.addEventListener('resize', () => {
                            renderTrades(window._currentPages[tableId] || 1);
                        });
                        
                    })
                    .catch(() => {
                        document.getElementById(statsBarId).innerHTML = "";
                        if (totalReturnBarId)
                            document.getElementById(
                                totalReturnBarId,
                            ).innerHTML = "";
                        if (paginationId)
                            document.getElementById(paginationId).innerHTML = "";
                        document.querySelector(`#${tableId} tbody`).innerHTML =
                            '<tr><td colspan="10" style="color: #ef4444; padding: 20px;">CSV file not found</td></tr>';
                    });
            }

            function renderStatsBarTo(stats, id) {
                const bar = document.getElementById(id);
                if (!stats) {
                    bar.innerHTML = "";
                    return;
                }
                const lang = (
                    navigator.language ||
                    navigator.userLanguage ||
                    ""
                ).toLowerCase();
                const isTR = lang.startsWith("tr");
                const labels = isTR
                    ? {
                          sharpe: "Sharpe Ratio: Riske göre düzeltilmiş getiri oranı. Daha yüksek değer, daha iyi risk-ayarlı performans.",
                          win: "Win Rate: Kazanılan işlemlerin yüzdesi. Yüksek oran, daha fazla başarılı işlem demektir.",
                          rr: "Avg R:R: Ortalama Risk/Ödül oranı. 1'den büyükse, kazançlar kayıplardan daha büyüktür.",
                          dd: "Max Drawdown: En büyük sermaye düşüşü. Düşük olması daha iyidir.",
                          week: "Weekly Return: Son haftanın toplam net getirisi.",
                          month: "Monthly Return: Son ayın toplam net getirisi.",
                          n: "# of Trades: Toplam işlem sayısı.",
                      }
                    : {
                          sharpe: "Sharpe Ratio: Risk-adjusted return. Higher is better.",
                          win: "Win Rate: Percentage of winning trades. Higher means more successful trades.",
                          rr: "Avg R:R: Average Risk/Reward ratio. Above 1 means gains are larger than losses.",
                          dd: "Max Drawdown: Largest equity drop. Lower is better.",
                          week: "Weekly Return: Net return for the last week.",
                          month: "Monthly Return: Net return for the last month.",
                          n: "# of Trades: Total number of trades.",
                      };
                bar.innerHTML = `
        <div class="stat-box" data-info="${labels.sharpe}"><div class="stat-label">Sharpe Ratio</div><div class="stat-value stat-sharpe">${stats.sharpe}</div></div>
        <div class="stat-box" data-info="${labels.win}"><div class="stat-label">Win Rate</div><div class="stat-value stat-win">${stats.winRate}</div></div>
        <div class="stat-box" data-info="${labels.rr}"><div class="stat-label">Avg R:R</div><div class="stat-value stat-rr">${stats.avgRR}</div></div>
        <div class="stat-box" data-info="${labels.dd}"><div class="stat-label">Max Drawdown</div><div class="stat-value stat-dd">${stats.maxDraw}</div></div>
        <div class="stat-box" data-info="${labels.week}"><div class="stat-label">Weekly Return</div><div class="stat-value stat-week">${stats.weekNet}</div></div>
        <div class="stat-box" data-info="${labels.month}"><div class="stat-label">Monthly Return</div><div class="stat-value stat-month">${stats.monthNet}</div></div>
        <div class="stat-box" data-info="${labels.n}"><div class="stat-label"># of Trades</div><div class="stat-value stat-n">${stats.n}</div></div>
      `;
            }

            function isAnyEquityModalOpen() {
                return !!document.querySelector('[id^="equity-modal-"][style*="display: flex"]');
            }
            function loadAll() {
                if (isAnyEquityModalOpen()) return;

                loadTradesGeneric(
                    "foddsignal.csv",
                    "stats-bar",
                    "tradeTable",
                    "total-return-bar",
                    "pagination-container-1"
                );
                loadTradesGeneric(
                    "foddv2.csv",
                    "stats-bar-v2",
                    "tradeTable-v2",
                    "total-return-bar-v2",
                    "pagination-container-2"
                );
            }
            document.addEventListener("DOMContentLoaded", loadAll);
            setInterval(loadAll, 5000);
        


            
            document.addEventListener("DOMContentLoaded", function () {
                const popup = document.getElementById("info-popup");
                function showPopup(text, x, y) {
                    popup.textContent = text;
                    popup.style.display = "block";
                    popup.style.opacity = "0";
                    popup.style.pointerEvents = "auto";
                    
                    popup.style.left = "0px";
                    popup.style.top = "0px";
                    
                    const popupRect = popup.getBoundingClientRect();
                    const winW = window.innerWidth;
                    const winH = window.innerHeight;
                    let left = x;
                    let top = y;
                    
                    if (left + popupRect.width > winW - 8) {
                        left = winW - popupRect.width - 8;
                    }
                    
                    if (left < 8) {
                        left = 8;
                    }
                    
                    if (top + popupRect.height > winH - 8) {
                        top = y - popupRect.height - 24;
                    }
                    
                    if (top < 8) {
                        top = 8;
                    }
                    popup.style.left = left + "px";
                    popup.style.top = top + "px";
                    popup.style.opacity = "1";
                }
                function hidePopup() {
                    popup.style.opacity = "0";
                    popup.style.pointerEvents = "none";
                    popup.style.display = "none";
                }
                document.addEventListener("click", function (e) {
                    const statBox =
                        e.target.closest && e.target.closest(".stat-box");
                    const totalReturnBox =
                        e.target.closest && e.target.closest(".stat-total");
                    
                    if (statBox && statBox.dataset.info) {
                        const rect = statBox.getBoundingClientRect();
                        let x = rect.left + rect.width / 2 - 160;
                        let y = rect.bottom + 12;

                        if (y + 100 > window.innerHeight) {
                            y = rect.top - 70;
                        }

                        showPopup(statBox.dataset.info, x, y);
                    } else if (!totalReturnBox) {
                        hidePopup();
                    }
                });
                window.addEventListener("scroll", hidePopup);
                window.addEventListener("resize", hidePopup);
            });