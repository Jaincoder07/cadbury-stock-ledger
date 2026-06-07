import React, { useState, useEffect, useMemo, useCallback } from "react";

// Seed products from client's actual Cadbury stock sheet:
// [code, desc, mrp, pcsOuter (Box=outer), pcsCase, openCase, openBox, openPcs]
const SEED = [["FUSE20","CADBURY FUSE 27.5G",20.0,24,384,23,7,22],["FUSE40","CAD FUSE 50G RS-40",40.0,24,216,2,4,12],["FUSE45","CAD FUSE 43G",45.0,24,216,0,0,0],["FUSE50","CAD FUSE 43G",50.0,24,216,0,0,0],["SBB195","CDM SILK BUBBLY 195",195.0,10,60,2,1,8],["SBBN195","CDM SILK BUBBLY 195 8 OTR",195.0,10,80,0,0,0],["SBBN195-2","CDM SILK BUBBLY 112g VLNTN 8 OTR",195.0,10,80,0,0,0],["SBS90","CDM SILK BUBBLY RS-90 8 OTR",90.0,20,160,0,0,1],["SBSN90","CDM SILK BUBBLY RS-90 6 OTR",90.0,20,120,0,0,0],["SBSN90-2","CDM SILK BUBBLY RS 95 /- 8 OTR",95.0,20,160,0,0,0],["SBS100","CDM SILK BUBBLY RS 100/- 8 OTR",100.0,20,160,0,0,0],["SBS98","CDM SILK BUBBLY 46G RS. 98 PRICING",98.0,20,160,0,0,0],["SBSN100","CDM SILK BUBBLY RS 100/- 6 OTR",100.0,20,120,0,0,0],["SBSB220","CDM SILK BUBBLY 220/-  8 OTR",220.0,10,80,0,0,0],["SBSB240","CDM SILK BUBBLY 240/-  8 OTR",240.0,10,80,0,0,0],["SBSB214","CDM SILK BUBBLY 112G RS. 214 PRC",214.0,10,80,0,0,0],["SBS110","CDM SILK BUBBLY RS 110/- 8 OTR",110.0,20,160,0,0,0],["Silk140","Silk Plum 140/-",140.0,24,144,0,2,1],["Silk140-2","Silk Walnut 140/-",140.0,24,144,1,0,7],["CDMS120","CDM SILK UI WALNUT BROWNIE 70G  RS. 120",120.0,24,144,0,0,0],["CDMS107","CDM SILK UI WALNUT BROWNIE 70G  RS.107 PRC",107.0,24,144,0,0,0],["CDMS107-2","CDM SILK UI PLUM CAKE 70G  RS. 107",107.0,24,144,0,0,0],["CDMS120-2","CDM SILK UI PLUM CAKE 70G  RS. 120",120.0,24,144,0,0,0],["SOB195","CDM SILK OREO 195",195.0,12,72,17,5,9],["SOS","CDM SILK OREO 60G RS-90--",90.0,32,192,8,4,21],["SOS95","CDM SILK OREO 60G RS-95/-",95.0,32,192,0,0,0],["SOB","CDM SILK OREO 130g crtn vltn",195.0,12,72,0,0,0],["SOB100","CDM SILK OREO 60G RS-100/-",100.0,32,192,0,0,0],["SOS110","CDM SILK OREO 58.5G RS-110/-",110.0,32,192,0,0,0],["SOS98","CDM SILK OREO 58.5G RS-98/-",98.0,32,192,0,0,0],["SOB220","CDM SILK OREO 220",220.0,12,72,0,0,0],["SOS65","CDM SILK OREO XS 40G",65.0,32,192,0,0,0],["SOS58","CDM SILK OREO XS 40G",58.0,32,192,0,0,0],["SOB240","CDM SILK OREO 240",240.0,12,72,0,0,0],["SOB214","CDM SILK OREO 124G RS. 214 PRC",214.0,12,72,0,0,0],["Silk280","Silk Plum 280/-",280.0,10,60,0,4,4],["Silk280-2","Silk Walnut 280/-",280.0,10,60,2,1,1],["CDMS300","CDM SILK UI WALNUT BROWNIE 140G",300.0,10,60,0,0,0],["CDMS267","CDM SILK  WALNUT BROWNIE 140G RS.267 PRC",267.0,10,60,0,0,0],["SGB195","Silk Ganache 195",195.0,10,60,5,2,7],["SGS90","Silk Ganache 90",90.0,32,192,6,4,21],["SGS95","Silk Ganache 95/-",95.0,32,192,0,0,0],["SGB146","Silk Ganache 146g valntn",195.0,10,60,0,0,0],["SGB220","Silk Ganache LARGE 146G 220/-",220.0,10,60,0,0,0],["SGB214","Silk Ganache LARGE 137G 214/-",214.0,10,60,0,0,0],["SGB240","Silk Ganache LARGE 137G 240/-",240.0,10,60,0,0,0],["SGS98","Silk Ganache 54G 98/-",98.0,32,192,0,0,0],["SGS100","Silk Ganache 100/-",100.0,32,192,0,0,0],["SGS110","Silk Ganache 54G 110/-",110.0,32,192,0,0,0],["SmoS90","SILK Mousse",90.0,24,144,0,1,12],["SmoB195","SILK Mousse",195.0,12,72,0,0,1],["SmoB220","SILK Mousse",220.0,12,72,0,0,0],["SmoB240","SILK Mousse",240.0,12,72,0,0,0],["SmoB214","CDM SILK MOUSSE 110G RS. 214 PRC",214.0,12,72,0,0,0],["SmoS95","SILK Mousse MRP 95 /-",95.0,24,144,0,0,0],["SmoS100","SILK Mousse 50G MRP 100 /-",100.0,24,144,0,0,0],["SmoS98","SILK Mousse 48.5G MRP 98 /-",98.0,24,144,0,0,0],["SmoS110","SILK Mousse 50G MRP 110 /-",110.0,24,144,0,0,0],["RA90","SILK Roast Almond",90.0,30,180,0,0,0],["RA95","SILK Roast Almond 95/-",95.0,30,180,0,0,0],["RA100","SILK Roast Almond 58G 100/-",100.0,30,180,0,0,0],["RA110","SILK Roast Almond 52G 110/-",110.0,30,180,0,0,0],["RA98","CDM SILK RA 52G RS. 98 PRC",98.0,30,180,0,0,0],["RA195","SILK Roast Almond",195.0,10,60,0,0,1],["RAN195","SILK Roast Almond 143G VLTN",195.0,10,60,0,0,0],["RA220","SILK Roast Almond 143G VLTN",220.0,10,60,0,0,0],["RA240","SILK Roast Almond 143G VLTN 240/-",240.0,10,60,0,0,0],["CDMS214","CDM SILK TRA 134G RS. 214 PRC",214.0,10,60,0,0,0],["CRISP35","Crispello",35.0,28,224,6,5,18],["CRISP10","Crispello",10.0,40,480,5,8,47],["CRISPN10","CDM Crispello 12.5G RS. 10/-",10.0,44,528,0,0,0],["CRISP20","CDM CRISPELLO 19.5G RS.20",20.0,30,300,0,0,0],["CRISP40","Crispello",40.0,28,224,0,0,0],["CRISP45","Crispello",45.0,28,224,0,0,0],["TAL110","Tempt Almond",110.0,10,60,0,0,6],["TRR120","Tempt Rum Raisin",120.0,10,60,1,1,1],["Bvillel50","Bville 50%",50.0,40,400,0,0,4],["Bvillel55","Bville 50% 55/-",55.0,40,400,0,0,0],["Bvillel60","Bville 50% 60/-",60.0,40,400,0,0,0],["BOURNVILLEN53","BOURNVILLE RICH COCOA 30G 40U PRC",53.0,40,400,0,0,0],["Bvillal110","Bvilla50%",110.0,10,60,0,0,0],["BVillel110","BVille70%",110.0,10,60,0,1,5],["BVilleFNl55","BVilleFN",55.0,40,400,8,2,16],["BVilleFNl53","BVilleFN 30G PRC",53.0,40,400,0,0,0],["BVilleFNl60","BVilleFN",60.0,40,400,0,0,0],["CR60","BVILLE CRANBERRY 30G",60.0,44,440,0,0,0],["CR60-2","BVILLE CRANBERRY 30G",53.0,44,176,0,0,0],["BRR110","Bville Rum Raisin",110.0,10,60,0,0,0],["BFN110","Bville F&N",110.0,10,60,0,0,0],["TAL120","Tempt Almond",120.0,10,60,0,0,0],["CR110","Bville CRANBERRY",110.0,10,60,0,0,0],["CR120","Bville CRANBERRY",120.0,10,60,0,0,0],["RC120","Bville RC 80G CRTN PK",120.0,10,60,0,0,0],["RC12070","Bville 70 % RICH COCOA",120.0,10,60,0,0,0],["RCF120","Bville F&N 120/- 80G",120.0,10,60,0,0,0],["BVIL120","Bville RUM & RAISIN  120/- 80G",120.0,10,60,0,0,0],["RC13070","Bville 70 % RICH COCOA 130 /-",130.0,10,60,0,0,0],["RCF130","Bville F&N 130/- 80G",130.0,10,60,0,0,0],["RCF140","Bville F&N 140/- 75G",140.0,10,60,0,0,0],["RCF134","BOURNVILLE FRUIT & NUT 75G RS. 134 PRC",134.0,10,60,0,0,0],["BVIL130","Bville RUM & RAISIN  130/- 80G",130.0,10,60,0,0,0],["BVIL134","Bville RUM & RAISIN  134/- 78g",134.0,10,60,0,0,0],["BVIL140","Bville RUM & RAISIN  140/- 78g",140.0,10,60,0,0,0],["CR130","Bville CRANBERRY 130 /-",130.0,10,60,0,0,0],["CR140","Bville CRANBERRY 140 /-",140.0,10,60,0,0,0],["CR135","Bville CRANBERRY 140 /-",140.0,10,60,0,0,0],["CR134","Bville CRANBERRY 78G RS. 134 /- PRC",134.0,10,60,0,0,0],["RC130","Bville RC 80G CRTN PK",130.0,10,60,0,0,0],["BVILN134","BOURNVILLE RC 75G CARTON PK RS. 134 PRC",134.0,10,60,0,0,0],["BVILO134","BOURNVILLE 50% ORANGE 75G",134.0,10,60,0,0,0],["BVILO150","BOURNVILLE 70% ORANGE 75G",150.0,10,60,0,0,0],["TRR130","Tempt Rum Raisin",130.0,10,60,0,0,0],["TAL130","Tempt ALMOND TREAT 70G",130.0,10,60,0,0,0],["TAL125","Tempt ALMOND TREAT 70G 125/-",125.0,10,60,0,0,0],["TAL140","Tempt ALMOND TREAT 70G 140/-",140.0,10,60,0,0,0],["TRR140","TEMPTATION R&R 70G CRTN PK RS. 140",140.0,10,60,0,0,0],["TRR125","TEMPTATION R&R 70G CRTN PK RS.125 PRC",125.0,10,60,0,0,0],["RC150","Bville 70 % RICH COCOA 130 /-",150.0,10,60,0,0,0],["RC140","Bville RC 75G CARTON PK RS. 140 /-",140.0,10,60,0,0,0],["BV5","Bourn Vita Shakti 14.4G",5.0,14,1008,8,0,420],["BV26","Bourn Vita 70g 26 MRP",26.0,12,192,22,0,216],["BV30","Bourn Vita 70g 30 MRP",30.0,12,192,22,0,216],["BV30-2","Bourn Vita 81g 30 MRP",30.0,12,192,0,0,0],["BV345","Bourn Vita RS 45/-",45.0,6,96,0,0,32],["BV138","Bourn Vita 200G JAR 138mrp",138.0,1,30,6,0,17],["BV110","Bourn Vita 200G JAR AW CHG 110/-",110.0,1,30,0,0,0],["BV249","Bourn Vita Pouch 500gm 249 MRP",249.0,1,32,0,0,0],["BV270","Bourn Vita Pouch 500gm 270 MRP",270.0,1,32,0,0,0],["BV280","Bourn Vita Pouch 500gm 280 MRP",280.0,1,32,0,0,0],["BV150","Bourn Vita 200G JAR 150mrp",150.0,1,30,0,0,0],["BV255","Bourn Vita Pouch 500gm Promo 255 MRP",255.0,1,32,4,0,19],["BV150-2","BOURNVITA 200G POUCH",99.0,1,40,0,0,0],["BV270-2","Bourn Vita 500 Gm JAR 270/- MRP",270.0,0,15,9,0,4],["BV285","Bourn Vita 500 Gm JAR 285/- MRP",285.0,0,15,0,0,0],["BV295","BOURNVITA 500G JAR OMNI Q'3",295.0,0,15,0,0,0],["BV263","Bourn Vita 500 Gm JAR 263/- MRP",263.0,0,15,0,0,0],["BV470","Bourn Vita Refill 1 kg  470/- MRP",470.0,0,12,5,0,7],["BV458","Bourn Vita Refill 1 kg GP Q,3 PRC  458/- MRP",458.0,0,12,0,0,0],["BV500","Bourn Vita Refill 1 kg  500/- MRP",500.0,0,12,0,0,0],["BV506","Bourn Vita JAR 1 KG RS 506 /-",506.0,1,12,4,0,0],["BV530","Bourn Vita JAR 1 KG RS 530 /-",530.0,1,12,0,0,0],["BV485","Bourn Vita JAR 1 KG Q3 PRC 485/-",485.0,1,12,0,0,0],["BV545","Bourn Vita JAR 1 KG Q3",545.0,1,12,0,0,0],["BV461","Bourn Vita JAR 1 KG promo 461 /-",461.0,1,12,0,0,0],["BV310","Bourn Vita FSM Jar 310 MRP",310.0,1,15,1,0,0],["BV330","Bourn Vita FSM  JAR 500GM",330.0,1,15,0,0,0],["BV294","BOURNVITA FSM JAR 500G Q'3 PRC",294.0,1,15,0,0,0],["BV128","Bourn Vita 200G JAR 128",128.0,1,30,0,0,1],["BV155","Bourn Vita 200G JAR Q'3",155.0,1,30,0,0,0],["BV479","Bourn Vita 1 kg JAR MRP 479",479.0,1,12,2,0,9],["BV255-2","Bourn Vita 500 Gm Jar255 MRP",255.0,1,15,0,0,0],["BV239","Bourn Vita Pouch 500gm Promo 239 MRP",239.0,1,32,0,0,12],["BV230","Bourn Vita 230 MRP",230.0,1,32,0,0,33],["BV404","Bourn Vita 404 MRP Fsm",404.0,1,16,0,0,0],["BV458-2","Bourn Vita 458 MRP 1kG",458.0,1,8,0,0,0],["BV261","Bourn Vita FSN Refill 261 MRP",261.0,1,32,0,0,23],["BV305","BOURNVITA FSM POUCH 500G",305.0,1,32,0,0,0],["BV379","Bourn Vita 750 G Refill MRP 379",379.0,1,16,0,0,0],["TAL165","Tang 500 Gm Lemon",165.0,1,24,0,0,15],["TAO30","Tang Orange 30mrp",30.0,12,96,0,0,6],["TAO170","Tang 500 Gm ORANGE",170.0,1,24,0,0,0],["TAM170","Tang 500 Gm MANGO",170.0,1,24,0,0,0],["TAL170","Tang 500 Gm LEMON",170.0,1,24,0,0,0],["TAO5","Tang 15.3G ORANGE",5.0,12,360,0,0,0],["TAL5","Tang 15.3G LEMON",5.0,12,360,0,0,0],["TAM5","Tang 15.3G MANGO",5.0,12,360,0,0,0],["TAO280","Tang 750G ORANGE",280.0,1,12,0,0,0],["TAL280","Tang 750G LEMON",280.0,1,12,0,0,0],["TAM280","Tang 750G MANGO",280.0,1,12,0,0,0],["TAO30-2","Tang 75G ORANGE",30.0,12,96,0,0,0],["TAL30","Tang 75G LEMON",30.0,12,96,0,0,0],["TAM30","Tang 75G MANGO",30.0,12,96,0,0,0],["TAO5-2","Tang 17.2G ORANGE",5.0,12,360,0,0,0],["TAO30-3","Tang 75G ORANGE",26.0,12,96,0,0,0],["TAL30-2","Tang 75G LEMON",26.0,12,96,0,0,0],["TAM30-2","Tang 75G MANGO",26.0,12,96,0,0,0],["TAO170-2","Tang 500 Gm ORANGE",150.0,1,24,0,0,0],["TAM170-2","Tang 500 Gm MANGO",150.0,1,24,0,0,0],["TAL170-2","Tang 500 Gm LEMON",150.0,1,24,0,0,0],["RA49","CDM ROAST ALMOND 36G  49 /-",49.0,40,360,1,0,13],["RA55","CDM ROAST ALMOND",55.0,40,360,1,0,13],["FN55","CDM FRUIT&NUT",55.0,40,360,2,4,11],["FN49","CDM FRUIT&NUT 36G 49/-",49.0,40,360,0,0,0],["CRAK10","CDM CRACKLE PRC",10.0,52,624,0,0,0],["CRAK55","CDM CRACKLE",55.0,40,360,2,6,7],["CRAK49","CDM CRACKLE PRC",49.0,40,360,0,0,0],["CDMM50","CDM MOCHA ALMOND",50.0,40,360,2,2,5],["FN110","CDM F&N 75G 110/-",110.0,15,150,1,2,6],["FN120","CDM F&N 75G 120/-",120.0,15,150,1,0,0],["FN107","CDM F&N 75G 107/-",107.0,15,150,1,0,0],["RA45","ROAST ALMOND",45.0,40,360,0,0,0],["RA100-2","ROAST ALMOND",100.0,15,150,0,0,0],["RA50","ROAST ALMOND",50.0,40,360,0,0,2],["RA110-2","CDM ROAST ALMOND 75G 110/-",110.0,15,150,1,1,4],["RA107","CDM ROAST ALMOND 75G 107/-",107.0,15,150,0,0,0],["RA120","CDM ROAST ALMOND 75G 120/-",120.0,15,150,0,0,0],["FN50","CDM FRUIT&NUT 50/-",50.0,40,360,0,0,0],["FN90","CDM FRUIT&NUT90",90.0,15,150,0,0,1],["FN100","CDM FRUIT&NUT 100/-",100.0,15,150,0,0,6],["CRAK45","CDM CRACKLE45",45.0,40,360,0,0,0],["CRAK90","CDM CRACKLE90",90.0,15,150,0,1,5],["CRAK107","CDM CRACKLE 75G 107/-",107.0,15,150,0,0,0],["CRAK110","CDM CRACKLE 75G 110/-",110.0,15,150,1,4,10],["CRAK120","CDM CRACKLE 75G 120/-",120.0,15,150,0,0,0],["CRAK50","CDM CRACKLE 50",50.0,40,360,0,0,0],["CDMK45","CDM KESARNUT45",45.0,40,360,0,0,0],["CDMC45","CDM CRUMBLE45",45.0,40,360,0,0,2],["BVB10","BOURNVITA BISCUITS",10.0,12,120,4,6,3],["BVB35","BOURNVITA BISCUITS",35.0,0,50,1,0,36],["BVB30","BOURNVITA BISCUITS",30.0,0,50,0,0,0],["SHORT5","SHORT 5",5.0,64,1152,2,3,28],["SHORT10","SHORT10",10.0,48,576,6,11,0],["GEMS45","GEMS SURPRISE 14.69G*12OT R45/-",45.0,12,144,0,0,0],["GEMS50","GEMS SURPRISE50",50.0,12,144,0,0,1],["NUTTY50","NUTTIES 50/-",50.0,24,192,1,7,22],["NUTTY45","NUTTIES 45/-",45.0,24,192,0,0,0],["LO5","LOLLY",5.0,48,1152,6,15,0],["LICK45","LICKABLES 45",45.0,12,108,0,0,0],["LICK50","LICKABLES 50",50.0,12,108,1,4,11],["GOLD10","CHOCLAIRS GOLD  10 /-",10.0,24,432,14,14,0],["SHORT116","SHORT116",116.0,58,50,0,0,47],["GOLD50","CHOCLAIRS GOLD50",50.0,10,80,2,1,12],["GOLD120","CHOCLAIRS GOLD120 60+2U",120.0,0,36,3,0,3],["GOLD200","CHOCLAIRS GOLD  200",200.0,105,18,2,0,16],["GOLDCO","CHOCLAIRS GOLD COFFEE 200",200.0,105,18,0,0,5],["GOLDCO120","CHOCLAIRS COFFE 120 60 UNIT",120.0,0,36,1,0,20],["GOLD60","CHOCLAIRS GOLD 60U 60",60.0,1,54,0,0,0],["HOT230","HOT CHOCOLATE 230",230.0,0,60,0,0,0],["COCO275","COCOA  POWDER 275",275.0,0,60,0,0,1],["COCO370","COCOA  POWDER  370",370.0,0,60,0,0,0],["COCO325","COCOA  POWDER 150G 325/-",325.0,0,60,4,0,34],["COCO329","COCOA  POWDER 150G Q'3 PRC 329/-",329.0,0,60,0,0,0],["HOT325","HOT CHOCOLATE 200G 325/-",325.0,0,60,0,0,41],["HOT275","HOT CHOCOLATE 200G 275/-",275.0,0,60,0,0,41],["HOT289","HOT CHOCOLATE 200G Q'3 PRC",289.0,0,60,0,0,0],["CADBURYU30","CADBURY INSTANT HOT CHOC 30G",30.0,10,240,1,19,6],["GOLD180","CHOCLAIRS GOLD  2.8G*180U 5 STAR JAR",180.0,1,16,0,0,0],["GOLD240","CHOCLAIRS GOLD  240 /-",240.0,120,16,1,0,8],["GOLD1000","CHOCLAIRS GOLD  1000 /-",1000.0,0,2,19,0,1],["GOLD230","CHOCLAIRS GOLD  230 /-",230.0,120,16,0,0,0],["P244","CADBURY MINI TREAT 149/-",149.0,0,48,0,0,4],["CADBURYU220","CADBURY SILK MINI TREAT 220/-",220.0,0,48,0,0,0],["P246","GEMS MINI TREAT 100/-",100.0,0,48,1,0,0],["FIVE120","FIVE STAR MININ TREAT 120/-",120.0,0,64,2,0,8],["5STARHTS2496G","5STAR HTS 249.6G 200/-",200.0,0,48,0,0,0],["CDMH200","CDM HOME TREAT 140G RS. 200/-",200.0,0,48,0,0,0],["CHOCLAIRSGOLD120U","CHOCLAIRS GOLD 120U Rs.120",120.0,120,32,3,0,3],["P251","CADBURY FUSE MINI TREAT",120.0,0,60,0,0,79],["P252","CADBURY PERK MINI TREAT",100.0,0,32,0,0,30],["CDM120","CDM  MINI TREAT",120.0,0,60,0,0,54],["CDMW50","CDM WHOLE ALMOND BITES 30GM",50.0,14,168,0,10,11],["5 STARSTA60","5 STAR KITTED PACK 108G (18G*6U) RC",60.0,1,96,0,0,98],["CDMW100","CDM WHOLE ALMOND BITES 30GM",50.0,1,20,0,0,0],["HOT325-2","HOT CHOCOLATE 200G 325/-",325.0,0,60,0,0,0],["CADBURYU240","CADBURY SILK MINI TREAT 240/-",240.0,0,48,0,0,0],["SHT214","CADBURY SILK HOME TREATS 135G 214/-",214.0,0,48,0,0,0],["CADBURYU133","5STAR HT 166.6G(17UX9.8G)  133/-",133.0,1,48,0,0,0],["SHT133","CADBURY HOME TREATS 98G  133/-",133.0,1,60,0,0,0],["CADBURYU133-2","CADBURY ASSORTED TREATS 125.1G  133/-",133.0,1,48,0,0,0]];

const WAREHOUSES_DEFAULT = ["Main Warehouse"];

// movement columns the client uses
const MOVES = [
  { key: "in",     label: "Stock In",     sign: +1, color: "#1b7f4d" },
  { key: "out",    label: "Stock Out",    sign: -1, color: "#b3261e" },
  { key: "whole",  label: "Wholesale",    sign: -1, color: "#8a5a00" },
  { key: "retail", label: "Retail Extra", sign: -1, color: "#6b3fa0" },
  { key: "edit",   label: "Edit/Cancel",  sign: +1, color: "#0a6e7a" },
];

// ---------- helpers ----------
const todayStr = () => {
  const d = new Date();
  return d.toISOString().slice(0, 10);
};
const fmtDate = (s) => {
  const [y, m, dd] = s.split("-");
  const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m,10)-1];
  return `${dd}-${mo}-${y}`;
};
const addDays = (s, n) => {
  const d = new Date(s + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");

// total pieces from case/box/pcs using product pack ratios
const toPcs = (c, b, p, pcsCase, pcsOuter) =>
  (c || 0) * pcsCase + (b || 0) * pcsOuter + (p || 0);
// pcs back into case / box / pcs for display
const fromPcs = (total, pcsCase, pcsOuter) => {
  let t = total, neg = t < 0;
  t = Math.abs(t);
  const c = pcsCase > 0 ? Math.floor(t / pcsCase) : 0;
  t -= c * pcsCase;
  const b = pcsOuter > 0 ? Math.floor(t / pcsOuter) : 0;
  t -= b * pcsOuter;
  const p = t;
  const s = neg ? -1 : 1;
  return { c: c * s, b: b * s, p: p * s };
};

// storage keys
const K_PRODUCTS = "cad:products";
const K_WAREHOUSES = "cad:warehouses";
const K_CONFIG = "cad:config";

// pricing defaults (editable in the Configuration tab)
const CONFIG_DEFAULT = { ourMargin: 5.31, perSku: {} }; // ourMargin in %, fixed across SKUs
const SKU_DEFAULTS = { margin: 1.12, gst: 5, ws: 15 };  // retailer margin divisor, GST %, wholesale % off MRP

// per-SKU pricing: retail rate, RD (our cost incl GST), cost ex-GST, wholesale rate
const skuPricing = (mrp, cfg, ourMargin) => {
  const m = cfg.margin || SKU_DEFAULTS.margin;
  const retail = mrp / m;
  const rd = retail / (1 + ourMargin / 100);
  const cost = rd / (1 + (cfg.gst ?? SKU_DEFAULTS.gst) / 100);
  const ws = mrp * (1 - (cfg.ws ?? SKU_DEFAULTS.ws) / 100);
  return { retail, rd, cost, ws };
};
const mvKey = (wh, date) => `cad:mv:${wh}:${date}`;       // movements for a warehouse-day
const openKey = (wh, date) => `cad:open:${wh}:${date}`;   // opening snapshot (carry)
const countKey = (wh, date) => `cad:count:${wh}:${date}`; // physical stock-take counts

function sGet(key) {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
function sSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch { return false; }
}

// ---------- tiny decimal cell (for config: margins, GST %) ----------
function DecCell({ value, onChange, suffix }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => { setV(value == null ? "" : String(value)); }, [value]);
  return (
    <span className="dwrap">
      <input
        className="ncell dcell"
        inputMode="decimal"
        value={v}
        onChange={(e) => setV(e.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={() => {
          const n = parseFloat(v);
          if (isNaN(n)) { setV(value == null ? "" : String(value)); return; }
          onChange(n);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
      />
      {suffix && <span className="dsuf">{suffix}</span>}
    </span>
  );
}

// ---------- add product panel ----------
function AddProductPanel({ products, onAdd, onClose }) {
  const [f, setF] = useState({ code: "", desc: "", mrp: "", boxes: "", pcsOuter: "" });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const codeTrim = f.code.trim();
  const dupCode = codeTrim && products.some((p) => p.code.toLowerCase() === codeTrim.toLowerCase());
  const descTrim = f.desc.trim();
  const dupDesc = descTrim && products.find((p) => p.desc.trim().toLowerCase() === descTrim.toLowerCase() && Number(p.mrp) === parseFloat(f.mrp));
  const boxes = parseInt(f.boxes, 10) || 0;
  const pcsOuter = parseInt(f.pcsOuter, 10) || 0;
  const pcsCase = boxes * pcsOuter; // auto-calculated

  const submit = () => {
    setErr("");
    if (!codeTrim) return setErr("Code is required.");
    if (dupCode) return setErr(`Code "${codeTrim}" already exists — codes must be unique.`);
    if (!descTrim) return setErr("Description is required.");
    const mrp = parseFloat(f.mrp);
    if (!(mrp > 0)) return setErr("MRP must be a number greater than 0.");
    if (boxes <= 0) return setErr("Box/Case must be at least 1.");
    if (pcsOuter <= 0) return setErr("Pcs/Box must be at least 1.");
    if (dupDesc && !window.confirm(`A product with the same description and MRP already exists (code ${dupDesc.code}). Add anyway?`)) return;
    onAdd({ code: codeTrim, desc: descTrim, mrp, pcsOuter, pcsCase, openCase: 0, openBox: 0, openPcs: 0 });
    onClose();
  };

  return (
    <div className="addpanel">
      <div className="aprow">
        <label>Code<input value={f.code} onChange={set("code")} placeholder="e.g. FUSE60" className={dupCode ? "bad" : ""} /></label>
        <label className="wide">Description<input value={f.desc} onChange={set("desc")} placeholder="e.g. CADBURY FUSE 55G RS-60" /></label>
        <label>MRP ₹<input value={f.mrp} onChange={set("mrp")} inputMode="decimal" /></label>
        <label>Box/Case<input value={f.boxes} onChange={set("boxes")} inputMode="numeric" placeholder="10" /></label>
        <label>Pcs/Box<input value={f.pcsOuter} onChange={set("pcsOuter")} inputMode="numeric" placeholder="20" /></label>
        <label>Pcs/Case<span className="apauto">{pcsCase > 0 ? pcsCase : "auto"}</span></label>
        <button className="save" onClick={submit}>Add Product</button>
        <button className="ghost2" onClick={onClose}>Cancel</button>
      </div>
      {dupCode && <div className="aperr">⚠ Code "{codeTrim}" is already taken.</div>}
      {!dupCode && dupDesc && <div className="apwarn">⚠ Same description + MRP exists as code {dupDesc.code} — possible duplicate.</div>}
      {err && <div className="aperr">{err}</div>}
    </div>
  );
}

// ---------- tiny numeric cell ----------
function NumCell({ value, onChange, accent }) {
  const [v, setV] = useState(value === 0 || value == null ? "" : String(value));
  useEffect(() => { setV(value === 0 || value == null ? "" : String(value)); }, [value]);
  return (
    <input
      className="ncell"
      inputMode="numeric"
      value={v}
      style={accent ? { color: accent } : undefined}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9\-]/g, "");
        setV(raw);
      }}
      onBlur={() => {
        const n = parseInt(v, 10);
        onChange(isNaN(n) ? 0 : n);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
    />
  );
}

export default function App() {
  const [products, setProducts] = useState(null);
  const [warehouses, setWarehouses] = useState(WAREHOUSES_DEFAULT);
  const [wh, setWh] = useState(WAREHOUSES_DEFAULT[0]);
  const [date, setDate] = useState(todayStr());
  const [moves, setMoves] = useState({});       // code -> {in:{c,b,p}, out:{...}, ...}
  const [opening, setOpening] = useState({});    // code -> pcs (carried)
  const [query, setQuery] = useState("");
  const [activeMove, setActiveMove] = useState("in");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("entry");       // entry | report | config
  const [showZero, setShowZero] = useState(true);
  const [config, setConfig] = useState(CONFIG_DEFAULT);

  // config is not day-based — persist immediately on every change
  const saveConfig = (next) => { setConfig(next); sSet(K_CONFIG, next); };
  const setSkuCfg = (code, field, val) => {
    const next = { ...config, perSku: { ...config.perSku, [code]: { ...(config.perSku[code] || {}), [field]: val } } };
    saveConfig(next);
  };
  const [showAdd, setShowAdd] = useState(false);

  // ---- physical stock take (per warehouse-day, auto-saved) ----
  const [counts, setCounts] = useState({});          // code -> {c,b,p}; row present = counted
  const [onlyDiff, setOnlyDiff] = useState(false);
  useEffect(() => { setCounts(sGet(countKey(wh, date)) || {}); }, [wh, date]);
  const setCount = (code, dim, val) => {
    setCounts((prev) => {
      const next = { ...prev, [code]: { ...(prev[code] || { c: 0, b: 0, p: 0 }), [dim]: val } };
      sSet(countKey(wh, date), next);
      return next;
    });
  };
  const clearCount = (code) => {
    setCounts((prev) => {
      const next = { ...prev };
      delete next[code];
      sSet(countKey(wh, date), next);
      return next;
    });
  };

  // ---- product master mutations (persist immediately) ----
  const updateProduct = (code, fields) => {
    setProducts((prev) => {
      const next = prev.map((p) => (p.code === code ? { ...p, ...fields } : p));
      sSet(K_PRODUCTS, next);
      return next;
    });
  };

  // ---- row-level edit mode in config (prevents accidental edits) ----
  const [editRow, setEditRow] = useState(null);          // product code being edited
  const [editPack, setEditPack] = useState({ boxes: 0, pcsOuter: 0 });
  const startEdit = (p) => {
    setEditRow(p.code);
    setEditPack({ boxes: p.pcsOuter > 0 ? Math.round(p.pcsCase / p.pcsOuter) : 0, pcsOuter: p.pcsOuter });
  };
  const changePack = (code, dim, val) => {
    const np = { ...editPack, [dim]: Math.max(0, val) };
    setEditPack(np);
    if (np.boxes > 0 && np.pcsOuter > 0) {
      updateProduct(code, { pcsOuter: np.pcsOuter, pcsCase: np.boxes * np.pcsOuter });
    }
  };
  const addProduct = (np) => {
    setProducts((prev) => {
      const next = [...prev, np];
      sSet(K_PRODUCTS, next);
      return next;
    });
    // make its opening stock visible on the currently loaded day
    const op = toPcs(np.openCase, np.openBox, np.openPcs, np.pcsCase, np.pcsOuter);
    if (op) setOpening((prev) => ({ ...prev, [np.code]: op }));
  };

  // ---- load products + warehouses once ----
  useEffect(() => {
    (() => {
      let p = sGet(K_PRODUCTS);
      if (!p) {
        p = SEED.map((r) => ({
          code: r[0], desc: r[1], mrp: r[2],
          pcsOuter: r[3], pcsCase: r[4],
          openCase: r[5], openBox: r[6], openPcs: r[7],
        }));
        sSet(K_PRODUCTS, p);
      }
      setProducts(p);
      let w = sGet(K_WAREHOUSES);
      if (!w) { w = WAREHOUSES_DEFAULT; sSet(K_WAREHOUSES, w); }
      setWarehouses(w);
      setWh(w[0]);
      const cfg = sGet(K_CONFIG);
      if (cfg) setConfig({ ...CONFIG_DEFAULT, ...cfg, perSku: cfg.perSku || {} });
      setLoading(false);
    })();
  }, []);

  // ---- load a warehouse-day (opening + movements) ----
  const loadDay = useCallback((whName, d, prods) => {
    if (!prods) return;
    // opening: try stored snapshot; else previous day's closing; else product master opening
    let open = sGet(openKey(whName, d));
    if (!open) {
      const prev = addDays(d, -1);
      const prevMoves = sGet(mvKey(whName, prev));
      const prevOpen = sGet(openKey(whName, prev));
      if (prevMoves || prevOpen) {
        // compute previous closing
        open = {};
        prods.forEach((pr) => {
          const o = (prevOpen && prevOpen[pr.code] != null)
            ? prevOpen[pr.code]
            : toPcs(pr.openCase, pr.openBox, pr.openPcs, pr.pcsCase, pr.pcsOuter);
          let net = 0;
          const mv = prevMoves && prevMoves[pr.code];
          if (mv) {
            MOVES.forEach((m) => {
              const cell = mv[m.key];
              if (cell) net += m.sign * toPcs(cell.c, cell.b, cell.p, pr.pcsCase, pr.pcsOuter);
            });
          }
          open[pr.code] = o + net;
        });
      } else {
        // first ever day → master opening
        open = {};
        prods.forEach((pr) => {
          open[pr.code] = toPcs(pr.openCase, pr.openBox, pr.openPcs, pr.pcsCase, pr.pcsOuter);
        });
      }
    }
    setOpening(open);
    const mv = (sGet(mvKey(whName, d))) || {};
    setMoves(mv);
  }, []);

  useEffect(() => { if (products) loadDay(wh, date, products); }, [wh, date, products, loadDay]);

  const prodByCode = useMemo(() => {
    const m = {}; (products || []).forEach((p) => (m[p.code] = p)); return m;
  }, [products]);

  // ---- closing per product (pcs) ----
  const closingPcs = useCallback((code) => {
    const pr = prodByCode[code]; if (!pr) return 0;
    const o = opening[code] || 0;
    let net = 0;
    const mv = moves[code];
    if (mv) MOVES.forEach((m) => {
      const cell = mv[m.key];
      if (cell) net += m.sign * toPcs(cell.c, cell.b, cell.p, pr.pcsCase, pr.pcsOuter);
    });
    return o + net;
  }, [opening, moves, prodByCode]);

  // ---- update a single cell ----
  const setCell = (code, moveKey, dim, val) => {
    setMoves((prev) => {
      const next = { ...prev };
      const row = { ...(next[code] || {}) };
      const cell = { ...(row[moveKey] || { c: 0, b: 0, p: 0 }) };
      cell[dim] = val;
      row[moveKey] = cell;
      next[code] = row;
      return next;
    });
    setSavedAt(null);
  };

  // ---- save day ----
  const save = () => {
    setSaving(true);
    sSet(mvKey(wh, date), moves);
    sSet(openKey(wh, date), opening); // lock opening so it's stable
    // also push closing as next day's opening snapshot
    const close = {};
    (products || []).forEach((pr) => { close[pr.code] = closingPcs(pr.code); });
    sSet(openKey(wh, addDays(date, 1)), close);
    setSaving(false);
    setSavedAt(new Date());
  };

  // ---- filtered rows ----
  const rows = useMemo(() => {
    if (!products) return [];
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (q && !(p.desc.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))) return false;
      if (!showZero && tab !== "config") {
        const hasMv = moves[p.code] && Object.values(moves[p.code]).some((c) => c && (c.c || c.b || c.p));
        const o = opening[p.code] || 0;
        if (!hasMv && o === 0) return false;
      }
      return true;
    });
  }, [products, query, showZero, moves, opening, tab]);

  // ---- day totals ----
  const totals = useMemo(() => {
    let openVal = 0, closeVal = 0;
    const mvTot = {}; MOVES.forEach((m) => (mvTot[m.key] = 0));
    (products || []).forEach((pr) => {
      openVal += (opening[pr.code] || 0) * pr.mrp;
      closeVal += closingPcs(pr.code) * pr.mrp;
      const mv = moves[pr.code];
      if (mv) MOVES.forEach((m) => {
        const c = mv[m.key];
        if (c) mvTot[m.key] += toPcs(c.c, c.b, c.p, pr.pcsCase, pr.pcsOuter);
      });
    });
    return { openVal, closeVal, mvTot };
  }, [products, opening, moves, closingPcs]);

  // ---- stock-take summary ----
  const stTotals = useMemo(() => {
    let counted = 0, matched = 0, short = 0, excess = 0, shortPcs = 0, excessPcs = 0, diffVal = 0;
    (products || []).forEach((pr) => {
      const ct = counts[pr.code];
      if (!ct) return;
      counted++;
      const phys = toPcs(ct.c, ct.b, ct.p, pr.pcsCase, pr.pcsOuter);
      const d = phys - closingPcs(pr.code);
      if (d === 0) matched++;
      else if (d < 0) { short++; shortPcs += -d; }
      else { excess++; excessPcs += d; }
      diffVal += d * pr.mrp;
    });
    return { counted, matched, short, excess, shortPcs, excessPcs, diffVal };
  }, [products, counts, closingPcs]);

  // ---- warehouse management ----
  const addWarehouse = async () => {
    const name = prompt("New warehouse name:");
    if (!name) return;
    if (warehouses.includes(name)) { alert("Already exists"); return; }
    const w = [...warehouses, name];
    setWarehouses(w); sSet(K_WAREHOUSES, w); setWh(name);
  };

  if (loading) return (
    <div style={{ padding: 40, fontFamily: "monospace", color: "#5b4a3a" }}>Loading stock data…</div>
  );

  const activeMv = MOVES.find((m) => m.key === activeMove);

  return (
    <div className="wrap">
      <style>{CSS}</style>

      {/* ===== top bar ===== */}
      <div className="topbar">
        <div className="brand">
          <div className="logo">CAD</div>
          <div>
            <div className="title">STOCK LEDGER</div>
            <div className="sub">Cadbury Distribution · Warehouse Inventory</div>
          </div>
        </div>
        <div className="controls">
          <label className="ctl">
            <span>Warehouse</span>
            <select value={wh} onChange={(e) => setWh(e.target.value)}>
              {warehouses.map((w) => <option key={w}>{w}</option>)}
            </select>
          </label>
          <button className="ghost" onClick={addWarehouse} title="Add warehouse">＋</button>
          <label className="ctl">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button className="ghost" onClick={() => setDate(addDays(date, -1))}>‹ Prev</button>
          <button className="ghost" onClick={() => setDate(addDays(date, +1))}>Next ›</button>
          <button className="ghost" onClick={() => setDate(todayStr())}>Today</button>
        </div>
      </div>

      {/* ===== tabs ===== */}
      <div className="tabs">
        <button className={tab === "entry" ? "tab on" : "tab"} onClick={() => setTab("entry")}>Daily Entry</button>
        <button className={tab === "stocktake" ? "tab on" : "tab"} onClick={() => setTab("stocktake")}>Stock Take</button>
        <button className={tab === "report" ? "tab on" : "tab"} onClick={() => setTab("report")}>Stock Report</button>
        <button className={tab === "config" ? "tab on" : "tab"} onClick={() => setTab("config")}>Configuration</button>
        <div className="spacer" />
        {tab !== "config" && tab !== "stocktake" && (
          <div className="savebox">
            {savedAt && <span className="saved">✓ saved {savedAt.toLocaleTimeString()}</span>}
            {!savedAt && <span className="unsaved">unsaved changes</span>}
            <button className="save" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Day"}</button>
          </div>
        )}
        {(tab === "config" || tab === "stocktake") && <span className="saved" style={{ padding: "8px 0" }}>changes save automatically</span>}
      </div>

      {/* ===== entry ===== */}
      {tab === "entry" && (
        <>
          <div className="toolbar">
            <input className="search" placeholder="Search product or code…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="movepick">
              {MOVES.map((m) => (
                <button key={m.key}
                  className={activeMove === m.key ? "mp on" : "mp"}
                  style={activeMove === m.key ? { background: m.color, borderColor: m.color } : { color: m.color, borderColor: m.color }}
                  onClick={() => setActiveMove(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
            <label className="zt">
              <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} />
              show all
            </label>
          </div>

          <div className="hint">
            Type into <b style={{ color: activeMv.color }}>{activeMv.label}</b> — columns are <b>Case · Box · Pcs</b>.
            Closing carries to tomorrow's opening automatically. Switch movement type with the colored buttons.
          </div>

          <div className="gridwrap">
            <table className="grid">
              <thead>
                <tr>
                  <th className="stick code">Code</th>
                  <th className="stick desc">Product</th>
                  <th className="num">MRP</th>
                  <th className="grp">Opening<br /><span>C · B · P</span></th>
                  <th className="num">Open<br /><span>Pcs</span></th>
                  <th className="grp" style={{ color: activeMv.color }}>{activeMv.label}<br /><span>Case</span></th>
                  <th className="grp" style={{ color: activeMv.color }}><br /><span>Box</span></th>
                  <th className="grp" style={{ color: activeMv.color }}><br /><span>Pcs</span></th>
                  <th className="num" style={{ color: activeMv.color }}>Total<br /><span>Pcs</span></th>
                  <th className="grp closing">Closing<br /><span>C · B · P</span></th>
                  <th className="num closing">Close<br /><span>Pcs</span></th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const o = opening[p.code] || 0;
                  const od = fromPcs(o, p.pcsCase, p.pcsOuter);
                  const cl = closingPcs(p.code);
                  const cd = fromPcs(cl, p.pcsCase, p.pcsOuter);
                  const cell = (moves[p.code] && moves[p.code][activeMove]) || { c: 0, b: 0, p: 0 };
                  const neg = cl < 0;
                  return (
                    <tr key={p.code} className={neg ? "rneg" : ""}>
                      <td className="stick code mono">{p.code}</td>
                      <td className="stick desc">{p.desc}</td>
                      <td className="num dim">{p.mrp}</td>
                      <td className="cbp">{od.c}·{od.b}·{od.p}</td>
                      <td className="num dim">{o}</td>
                      <td className="inp"><NumCell value={cell.c} accent={activeMv.color} onChange={(v) => setCell(p.code, activeMove, "c", v)} /></td>
                      <td className="inp"><NumCell value={cell.b} accent={activeMv.color} onChange={(v) => setCell(p.code, activeMove, "b", v)} /></td>
                      <td className="inp"><NumCell value={cell.p} accent={activeMv.color} onChange={(v) => setCell(p.code, activeMove, "p", v)} /></td>
                      <td className="num" style={{ color: activeMv.color, fontWeight: 600 }}>{toPcs(cell.c, cell.b, cell.p, p.pcsCase, p.pcsOuter) || ""}</td>
                      <td className={"cbp closing" + (neg ? " negtxt" : "")}>{cd.c}·{cd.b}·{cd.p}</td>
                      <td className={"num closing" + (neg ? " negtxt" : "")}>{cl}</td>
                      <td className="num">{inr(cl * p.mrp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="footbar">
            <div>Showing <b>{rows.length}</b> / {products.length} products</div>
            <div className="ftot">
              {MOVES.map((m) => (
                <span key={m.key} style={{ color: m.color }}>{m.label}: <b>{totals.mvTot[m.key]}</b> pcs</span>
              ))}
            </div>
            <div>Opening <b>{inr(totals.openVal)}</b> → Closing <b>{inr(totals.closeVal)}</b></div>
          </div>
        </>
      )}

      {/* ===== stock take ===== */}
      {tab === "stocktake" && (
        <>
          <div className="rcards">
            <div className="rcard"><div className="rl">Counted</div><div className="rv">{stTotals.counted}<span className="rsub"> / {products.length}</span></div></div>
            <div className="rcard"><div className="rl">Matched</div><div className="rv" style={{ color: "#1b7f4d" }}>{stTotals.matched}</div></div>
            <div className="rcard"><div className="rl">Short</div><div className="rv" style={{ color: "#b3261e" }}>{stTotals.short}<span className="rsub"> items · {stTotals.shortPcs} pcs</span></div></div>
            <div className="rcard"><div className="rl">Excess</div><div className="rv" style={{ color: "#8a5a00" }}>{stTotals.excess}<span className="rsub"> items · {stTotals.excessPcs} pcs</span></div></div>
            <div className="rcard"><div className="rl">Net Diff Value (MRP)</div><div className="rv" style={{ color: stTotals.diffVal < 0 ? "#b3261e" : stTotals.diffVal > 0 ? "#8a5a00" : "#1b7f4d" }}>{inr(stTotals.diffVal)}</div></div>
          </div>

          <div className="toolbar">
            <input className="search" placeholder="Search product or code…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="zt">
              <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
              only differences
            </label>
          </div>

          <div className="hint">
            Enter the <b>physical count</b> as Case · Box · Pcs after counting the warehouse. Diff = Physical − System Closing
            (closing includes all of today's In/Out/Wholesale/Retail/Edit). Untouched rows are treated as <b>not counted</b> — use ⟲ to un-count a row.
          </div>

          <div className="gridwrap">
            <table className="grid">
              <thead>
                <tr>
                  <th className="stick code">Code</th>
                  <th className="stick desc">Product</th>
                  <th className="grp closing">System Closing<br /><span>C · B · P</span></th>
                  <th className="num closing">Pcs</th>
                  <th className="grp" style={{ color: "#0a6e7a" }}>Physical<br /><span>Case</span></th>
                  <th className="grp" style={{ color: "#0a6e7a" }}><br /><span>Box</span></th>
                  <th className="grp" style={{ color: "#0a6e7a" }}><br /><span>Pcs</span></th>
                  <th className="num">Physical Pcs</th>
                  <th className="num">Diff Pcs</th>
                  <th className="grp">Diff<br /><span>C · B · P</span></th>
                  <th className="num">Diff ₹</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const cl = closingPcs(p.code);
                  const cd = fromPcs(cl, p.pcsCase, p.pcsOuter);
                  const ct = counts[p.code];
                  const phys = ct ? toPcs(ct.c, ct.b, ct.p, p.pcsCase, p.pcsOuter) : null;
                  const d = ct ? phys - cl : null;
                  if (onlyDiff && (d === null || d === 0)) return null;
                  const dd = ct ? fromPcs(d, p.pcsCase, p.pcsOuter) : null;
                  const cls = d === null ? "" : d === 0 ? "rok" : d < 0 ? "rneg" : "rexc";
                  return (
                    <tr key={p.code} className={cls}>
                      <td className="stick code mono">{p.code}</td>
                      <td className="stick desc">{p.desc}</td>
                      <td className="cbp closing">{cd.c}·{cd.b}·{cd.p}</td>
                      <td className="num closing">{cl}</td>
                      <td className="inp"><NumCell value={ct ? ct.c : 0} accent="#0a6e7a" onChange={(v) => setCount(p.code, "c", v)} /></td>
                      <td className="inp"><NumCell value={ct ? ct.b : 0} accent="#0a6e7a" onChange={(v) => setCount(p.code, "b", v)} /></td>
                      <td className="inp"><NumCell value={ct ? ct.p : 0} accent="#0a6e7a" onChange={(v) => setCount(p.code, "p", v)} /></td>
                      <td className="num">{ct ? phys : "–"}</td>
                      <td className={"num " + (d === null ? "dim" : d < 0 ? "negtxt" : d > 0 ? "exctxt" : "oktxt")}>
                        {d === null ? "not counted" : d === 0 ? "✓ 0" : (d > 0 ? "+" : "") + d}
                      </td>
                      <td className="cbp">{ct && d !== 0 ? `${dd.c}·${dd.b}·${dd.p}` : ""}</td>
                      <td className={"num " + (d ? (d < 0 ? "negtxt" : "exctxt") : "dim")}>{ct && d !== 0 ? inr(d * p.mrp) : ""}</td>
                      <td className="inp">{ct && <button className="unct" title="Clear count (mark not counted)" onClick={() => clearCount(p.code)}>⟲</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="footbar">
            <div>Showing <b>{rows.length}</b> / {products.length} products</div>
            <div className="ftot">
              <span style={{ color: "#1b7f4d" }}>Matched: <b>{stTotals.matched}</b></span>
              <span style={{ color: "#b3261e" }}>Short: <b>{stTotals.shortPcs}</b> pcs</span>
              <span style={{ color: "#8a5a00" }}>Excess: <b>{stTotals.excessPcs}</b> pcs</span>
            </div>
            <div>Net diff <b style={{ color: stTotals.diffVal < 0 ? "#b3261e" : "#2a2018" }}>{inr(stTotals.diffVal)}</b> at MRP</div>
          </div>
        </>
      )}

      {/* ===== configuration ===== */}
      {tab === "config" && (
        <>
          <div className="toolbar">
            <input className="search" placeholder="Search product or code…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="zt" title="Our fixed wholesaler margin, applied on the retail rate. RD = Retail ÷ (1 + this)">
              Our margin&nbsp;
              <DecCell value={config.ourMargin} suffix="%" onChange={(v) => saveConfig({ ...config, ourMargin: v })} />
            </label>
            <button className="save" onClick={() => setShowAdd(!showAdd)}>{showAdd ? "✕ Close" : "＋ Add Product"}</button>
          </div>

          {showAdd && <AddProductPanel products={products} onAdd={addProduct} onClose={() => setShowAdd(false)} />}

          <div className="hint">
            Rows are read-only — click <b>✎ Edit</b> at the end of a row to change MRP, Box/Case, Pcs/Box, Margin, GST % or WS %.
            <b> Pcs/Case is auto-calculated</b> (Box/Case × Pcs/Box) and updates the master everywhere.
            Retails = MRP ÷ Margin · RD = Retails ÷ (1 + our %) · Cost = RD ÷ (1 + GST) — used for stock value.
          </div>

          <div className="gridwrap">
            <table className="grid">
              <thead>
                <tr>
                  <th className="stick code">Code</th>
                  <th className="stick desc">Product</th>
                  <th className="num">MRP</th>
                  <th className="num">Box/Case</th>
                  <th className="num">Pcs/Box</th>
                  <th className="num">Pcs/Case<br /><span>auto</span></th>
                  <th>Margin</th>
                  <th>GST %</th>
                  <th className="num">Retails</th>
                  <th className="num">RD</th>
                  <th className="num closing">Cost ex-GST</th>
                  <th>WS %</th>
                  <th className="num">WS Rate</th>
                  <th className="num">Cost/Case</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const cfg = config.perSku[p.code] || {};
                  const pr = skuPricing(p.mrp, cfg, config.ourMargin);
                  const editing = editRow === p.code;
                  const boxesShow = p.pcsOuter > 0 ? (p.pcsCase / p.pcsOuter).toFixed(1).replace(/\.0$/, "") : "–";
                  return (
                    <tr key={p.code} className={editing ? "redit" : ""}>
                      <td className="stick code mono">{p.code}</td>
                      <td className="stick desc">{p.desc}</td>
                      {editing ? (
                        <>
                          <td className="inp"><DecCell value={p.mrp} onChange={(v) => { if (v > 0) updateProduct(p.code, { mrp: v }); }} /></td>
                          <td className="inp"><NumCell value={editPack.boxes} onChange={(v) => changePack(p.code, "boxes", v)} /></td>
                          <td className="inp"><NumCell value={editPack.pcsOuter} onChange={(v) => changePack(p.code, "pcsOuter", v)} /></td>
                          <td className="num dim">{p.pcsCase}</td>
                          <td className="inp"><DecCell value={cfg.margin ?? SKU_DEFAULTS.margin} onChange={(v) => setSkuCfg(p.code, "margin", v)} /></td>
                          <td className="inp"><DecCell value={cfg.gst ?? SKU_DEFAULTS.gst} suffix="%" onChange={(v) => setSkuCfg(p.code, "gst", v)} /></td>
                        </>
                      ) : (
                        <>
                          <td className="num dim">{p.mrp}</td>
                          <td className="num">{boxesShow}</td>
                          <td className="num">{p.pcsOuter || "–"}</td>
                          <td className="num">{p.pcsCase || "–"}</td>
                          <td className="num dim">{(cfg.margin ?? SKU_DEFAULTS.margin).toFixed(2)}</td>
                          <td className="num dim">{cfg.gst ?? SKU_DEFAULTS.gst}%</td>
                        </>
                      )}
                      <td className="num">{pr.retail.toFixed(2)}</td>
                      <td className="num">{pr.rd.toFixed(2)}</td>
                      <td className="num closing">{pr.cost.toFixed(2)}</td>
                      {editing
                        ? <td className="inp"><DecCell value={cfg.ws ?? SKU_DEFAULTS.ws} suffix="%" onChange={(v) => setSkuCfg(p.code, "ws", v)} /></td>
                        : <td className="num dim">{cfg.ws ?? SKU_DEFAULTS.ws}%</td>}
                      <td className="num">{pr.ws.toFixed(2)}</td>
                      <td className="num dim">{(pr.cost * p.pcsCase).toFixed(2)}</td>
                      <td className="inp">
                        <button className={editing ? "unct edon" : "unct"} onClick={() => (editing ? setEditRow(null) : startEdit(p))}>
                          {editing ? "✓ Done" : "✎ Edit"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="footbar">
            <div>Showing <b>{rows.length}</b> / {products.length} products</div>
            <div className="ftot"><span>Retails = MRP ÷ Margin</span><span>RD = Retails ÷ (1 + {config.ourMargin}%)</span><span>Cost = RD ÷ (1 + GST)</span><span>WS Rate = MRP × (1 − WS%)</span></div>
          </div>
        </>
      )}

      {/* ===== report ===== */}
      {tab === "report" && (
        <div className="report">
          <div className="rcards">
            <div className="rcard"><div className="rl">Opening Value</div><div className="rv">{inr(totals.openVal)}</div></div>
            <div className="rcard"><div className="rl">Closing Value</div><div className="rv">{inr(totals.closeVal)}</div></div>
            <div className="rcard"><div className="rl">Stock In (pcs)</div><div className="rv" style={{ color: "#1b7f4d" }}>{totals.mvTot.in}</div></div>
            <div className="rcard"><div className="rl">Stock Out (pcs)</div><div className="rv" style={{ color: "#b3261e" }}>{totals.mvTot.out}</div></div>
            <div className="rcard"><div className="rl">Warehouse</div><div className="rv sm">{wh}</div></div>
            <div className="rcard"><div className="rl">As on</div><div className="rv sm">{fmtDate(date)}</div></div>
          </div>
          <div className="gridwrap">
            <table className="grid">
              <thead>
                <tr>
                  <th className="stick code">Code</th>
                  <th className="stick desc">Product</th>
                  <th className="num">MRP</th>
                  <th className="grp">Opening</th>
                  {MOVES.map((m) => <th key={m.key} className="num" style={{ color: m.color }}>{m.label}</th>)}
                  <th className="grp closing">Closing</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const o = opening[p.code] || 0;
                  const cl = closingPcs(p.code);
                  const cd = fromPcs(cl, p.pcsCase, p.pcsOuter);
                  const mv = moves[p.code] || {};
                  return (
                    <tr key={p.code} className={cl < 0 ? "rneg" : ""}>
                      <td className="stick code mono">{p.code}</td>
                      <td className="stick desc">{p.desc}</td>
                      <td className="num dim">{p.mrp}</td>
                      <td className="cbp">{fromPcs(o, p.pcsCase, p.pcsOuter).c}·{fromPcs(o, p.pcsCase, p.pcsOuter).b}·{fromPcs(o, p.pcsCase, p.pcsOuter).p}</td>
                      {MOVES.map((m) => {
                        const c = mv[m.key];
                        const t = c ? toPcs(c.c, c.b, c.p, p.pcsCase, p.pcsOuter) : 0;
                        return <td key={m.key} className="num dim">{t || ""}</td>;
                      })}
                      <td className={"cbp closing" + (cl < 0 ? " negtxt" : "")}>{cd.c}·{cd.b}·{cd.p}</td>
                      <td className="num">{inr(cl * p.mrp)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const CSS = `
* { box-sizing: border-box; }
.wrap { font-family: 'IBM Plex Sans', system-ui, sans-serif; background: #f4efe6; color: #2a2018; min-height: 100vh; }
.wrap input, .wrap select, .wrap button { font-family: inherit; }
.mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }

.topbar { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:14px 18px; background:#2a2018; color:#f4efe6; flex-wrap:wrap; }
.brand { display:flex; align-items:center; gap:12px; }
.logo { width:42px; height:42px; border-radius:9px; background:#6b1f24; color:#fff; display:grid; place-items:center; font-weight:800; letter-spacing:1px; font-size:14px; box-shadow:0 2px 0 #4a1419; }
.title { font-weight:800; letter-spacing:2px; font-size:18px; }
.sub { font-size:11px; opacity:.6; letter-spacing:.5px; }
.controls { display:flex; align-items:flex-end; gap:8px; flex-wrap:wrap; }
.ctl { display:flex; flex-direction:column; gap:3px; font-size:10px; text-transform:uppercase; letter-spacing:1px; opacity:.85; }
.ctl select, .ctl input { background:#3a2e22; border:1px solid #54442f; color:#f4efe6; border-radius:6px; padding:6px 8px; font-size:13px; }
.ghost { background:transparent; border:1px solid #54442f; color:#f4efe6; border-radius:6px; padding:7px 10px; cursor:pointer; font-size:12px; }
.ghost:hover { background:#3a2e22; }

.tabs { display:flex; align-items:center; gap:4px; padding:0 18px; background:#e7dccb; border-bottom:2px solid #d2c2a8; }
.tab { background:transparent; border:none; padding:11px 16px; cursor:pointer; font-weight:600; color:#6b5a45; border-bottom:3px solid transparent; font-size:13px; }
.tab.on { color:#6b1f24; border-bottom-color:#6b1f24; }
.spacer { flex:1; }
.savebox { display:flex; align-items:center; gap:10px; }
.saved { color:#1b7f4d; font-size:12px; }
.unsaved { color:#b3261e; font-size:12px; opacity:.8; }
.save { background:#6b1f24; color:#fff; border:none; padding:8px 16px; border-radius:6px; font-weight:700; cursor:pointer; }
.save:hover { background:#561a1e; }

.toolbar { display:flex; gap:12px; align-items:center; padding:12px 18px; flex-wrap:wrap; }
.search { flex:1; min-width:200px; padding:9px 12px; border:1px solid #d2c2a8; border-radius:7px; background:#fff; font-size:14px; }
.movepick { display:flex; gap:6px; flex-wrap:wrap; }
.mp { background:#fff; border:1.5px solid; border-radius:6px; padding:7px 11px; font-size:12px; font-weight:700; cursor:pointer; }
.mp.on { color:#fff !important; }
.zt { font-size:12px; display:flex; align-items:center; gap:5px; color:#6b5a45; }

.hint { padding:0 18px 10px; font-size:12px; color:#6b5a45; }

.gridwrap { overflow:auto; margin:0 14px; border:1px solid #d2c2a8; border-radius:8px; background:#fff; max-height:calc(100vh - 290px); }
.grid { border-collapse:separate; border-spacing:0; width:100%; font-size:12.5px; }
.grid thead th { position:sticky; top:0; z-index:3; background:#efe6d6; border-bottom:2px solid #d2c2a8; padding:6px 8px; text-align:center; font-size:10.5px; text-transform:uppercase; letter-spacing:.5px; color:#5b4a3a; white-space:nowrap; }
.grid thead th span { font-weight:500; opacity:.65; font-size:9.5px; }
.grid td { padding:3px 8px; border-bottom:1px solid #f0e8d8; white-space:nowrap; }
.grid tbody tr:hover td { background:#faf6ee; }
.stick { position:sticky; left:0; background:#fff; z-index:2; }
.code { left:0; min-width:78px; max-width:78px; font-size:11px; color:#6b5a45; border-right:1px solid #f0e8d8; }
.desc { left:78px; min-width:230px; max-width:230px; overflow:hidden; text-overflow:ellipsis; border-right:1px solid #e7dccb; font-weight:500; }
.grid thead th.code { z-index:4; }
.grid thead th.desc { z-index:4; }
.num { text-align:right; font-variant-numeric:tabular-nums; }
.dim { color:#9a8a72; }
.cbp { text-align:center; font-family:'IBM Plex Mono',monospace; font-size:11.5px; color:#4a3a28; }
.closing { background:#f3f7f3; font-weight:600; }
.grid thead th.closing { background:#e3eee3; color:#1b6b40; }
.inp { padding:1px 3px; text-align:center; }
.ncell { width:48px; border:1px solid #e0d4bf; border-radius:4px; padding:3px 4px; text-align:center; font-size:12.5px; background:#fffdf8; font-variant-numeric:tabular-nums; }
.ncell:focus { outline:none; border-color:#6b1f24; background:#fff; box-shadow:0 0 0 2px rgba(107,31,36,.12); }
.addpanel { margin:0 18px 10px; padding:12px 14px; background:#fff; border:1.5px solid #6b1f24; border-radius:9px; }
.aprow { display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; }
.aprow label { display:flex; flex-direction:column; gap:3px; font-size:10px; text-transform:uppercase; letter-spacing:.6px; color:#6b5a45; font-weight:600; }
.aprow input { border:1px solid #d2c2a8; border-radius:6px; padding:7px 9px; font-size:13px; width:90px; background:#fffdf8; }
.aprow input:focus { outline:none; border-color:#6b1f24; box-shadow:0 0 0 2px rgba(107,31,36,.12); }
.aprow input.bad { border-color:#b3261e; background:#fdecec; }
.aprow .wide input { width:260px; }
.ghost2 { background:transparent; border:1px solid #d2c2a8; color:#6b5a45; border-radius:6px; padding:8px 14px; cursor:pointer; font-size:12px; }
.apauto { display:inline-block; padding:7px 9px; font-size:13px; font-weight:700; color:#1b6b40; background:#f0f7f0; border:1px dashed #9cc0a5; border-radius:6px; min-width:50px; text-align:center; }
.redit td { background:#fdf9ee !important; }
.unct.edon { background:#1b7f4d; border-color:#1b7f4d; color:#fff; font-weight:700; }
.aperr { margin-top:8px; font-size:12px; color:#b3261e; font-weight:600; }
.apwarn { margin-top:8px; font-size:12px; color:#8a5a00; font-weight:600; }
.dwrap { display:inline-flex; align-items:center; gap:2px; }
.dcell { width:52px; }
.dsuf { font-size:10px; color:#9a8a72; }
.rneg td { background:#fdecec !important; }
.negtxt { color:#b3261e !important; }
.rexc td { background:#fdf6e3 !important; }
.rok td { background:#f0f7f0 !important; }
.exctxt { color:#8a5a00 !important; font-weight:600; }
.oktxt { color:#1b7f4d !important; font-weight:600; }
.rsub { font-size:11px; font-weight:500; color:#9a8a72; }
.unct { background:transparent; border:1px solid #d2c2a8; border-radius:4px; color:#6b5a45; cursor:pointer; font-size:12px; padding:2px 7px; }
.unct:hover { background:#f4efe6; }

.footbar { display:flex; justify-content:space-between; align-items:center; gap:18px; padding:11px 22px; font-size:12px; color:#5b4a3a; flex-wrap:wrap; }
.ftot { display:flex; gap:14px; flex-wrap:wrap; }

.report { padding:8px 4px; }
.rcards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; padding:10px 18px 16px; }
.rcard { background:#fff; border:1px solid #d2c2a8; border-radius:10px; padding:13px 15px; }
.rl { font-size:10.5px; text-transform:uppercase; letter-spacing:1px; color:#9a8a72; margin-bottom:5px; }
.rv { font-size:22px; font-weight:800; color:#2a2018; }
.rv.sm { font-size:14px; font-weight:700; }

@media (max-width:640px){
  .desc { min-width:150px; max-width:150px; }
  .desc { left:78px; }
  .gridwrap { max-height:calc(100vh - 340px); }
}
`;
